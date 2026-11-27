"""Generation-time selection of plain Python for one audited workflow mode.

Only the dispatcher's comparisons against the fixed mode are specialized. Kept
functions/classes/constants are emitted from their original source, unmodified.
No optimizer, loader, compression or dependency resolution runs in Actions.
"""
import ast
from pathlib import Path
import symtable

MODES = ('verify', 'fetch', 'candidate', 'prepare', 'integrate')
MODULES = ('diagnostics.py', 'ci.py', 'producer.py')
_UNKNOWN = object()


class FixedMode(ast.NodeTransformer):
    def __init__(self, mode):
        self.mode = mode

    def known(self, node):
        if isinstance(node, ast.Name) and node.id == 'mode':
            return self.mode
        if isinstance(node, ast.Compare) and len(node.ops) == 1:
            left, right = self.known(node.left), self.known(node.comparators[0])
            if left is _UNKNOWN or right is _UNKNOWN:
                return _UNKNOWN
            op = node.ops[0]
            if isinstance(op, ast.Eq): return left == right
            if isinstance(op, ast.NotEq): return left != right
            if isinstance(op, ast.In): return left in right
            if isinstance(op, ast.NotIn): return left not in right
        if isinstance(node, ast.BoolOp):
            for value in node.values:
                result = self.known(value)
                # Never discard an unknown expression's possible side effects.
                if result is _UNKNOWN: return _UNKNOWN
                if isinstance(node.op, ast.And) and not result: return False
                if isinstance(node.op, ast.Or) and result: return True
            return bool(result)
        try:
            return ast.literal_eval(node)
        except (ValueError, TypeError):
            return _UNKNOWN

    def visit_If(self, node):
        result = self.known(node.test)
        if result is _UNKNOWN:
            return self.generic_visit(node)
        return [child for statement in (node.body if result else node.orelse)
                for child in self.statements(statement)]

    def statements(self, node):
        result = self.visit(node)
        return result if isinstance(result, list) else [result]

    def visit_IfExp(self, node):
        result = self.known(node.test)
        if result is _UNKNOWN:
            return self.generic_visit(node)
        return self.visit(node.body if result else node.orelse)

    # Inner scopes may bind their own "mode". Leave them untouched.
    def visit_FunctionDef(self, node): return node
    def visit_AsyncFunctionDef(self, node): return node
    def visit_ClassDef(self, node): return node
    def visit_Lambda(self, node): return node


def specialize_main(node, mode):
    # Work on a copy; original source and general-purpose dispatcher stay intact.
    result = ast.parse(ast.unparse(node)).body[0]
    assignments = [i for i, statement in enumerate(result.body)
                   if isinstance(statement, ast.Assign) and
                   any(isinstance(t, ast.Name) and t.id == 'mode' for t in statement.targets)]
    if len(assignments) != 1:
        raise ValueError('dispatcher-mode-assignment')
    stores = [n for n in ast.walk(result) if isinstance(n, ast.Name) and
              n.id == 'mode' and isinstance(n.ctx, ast.Store)]
    if len(stores) != 1:
        raise ValueError('dispatcher-mode-reassignment')
    guard = ast.parse(f"require(mode == {mode!r}, 'producer-mode')").body[0]
    result.body.insert(assignments[0] + 1, guard)
    transformer = FixedMode(mode)
    result.body = [child for statement in result.body for child in transformer.statements(statement)]
    return ast.fix_missing_locations(result)


def globals_used(node):
    """Python's scope analysis excludes local variables shadowing global names."""
    def walk(table):
        names = {s.get_name() for s in table.get_symbols() if s.is_global() and s.is_referenced()}
        for child in table.get_children(): names.update(walk(child))
        return names
    return walk(symtable.symtable(ast.unparse(node), '<specops-inline>', 'exec'))


def source_chunk(source, node):
    first = min([node.lineno, *[d.lineno for d in getattr(node, 'decorator_list', [])]])
    return '\n'.join(source.splitlines()[first - 1:node.end_lineno])


def bundle(config, mode):
    if mode not in MODES:
        raise ValueError('unsupported-bundle-mode')
    declarations, imports, symbols, entrypoints = [], [], {}, []
    for module in MODULES:
        source = Path(__file__).with_name(module).read_text()
        for node in ast.parse(source).body:
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                if isinstance(node, ast.ImportFrom) and node.level:
                    if node.level != 1 or node.module not in ('ci', 'diagnostics'):
                        raise ValueError('unsupported-bundle-import')
                    continue
                imports.append(node)
                continue
            if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant):
                continue  # Module docstring, never execution or an encoded loader.
            if isinstance(node, ast.If) and module == 'producer.py':
                entrypoints.append(node)
                continue
            if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
                names = [node.name]
            elif isinstance(node, ast.Assign) and all(isinstance(t, ast.Name) for t in node.targets):
                names = [t.id for t in node.targets]
            else:
                raise ValueError('unsupported-bundle-declaration')
            code = source_chunk(source, node)
            if names == ['main']:
                node = specialize_main(node, mode)
                code = ast.unparse(node)
            elif names == ['CONFIG']:
                code = 'CONFIG = ' + repr(config)
                node = ast.parse(code).body[0]
            item = (module, node, code)
            declarations.append(item)
            for name in names:
                if name in symbols: raise ValueError('duplicate-bundle-symbol')
                symbols[name] = item
    if len(entrypoints) != 1:
        raise ValueError('bundle-entrypoint')
    needed, pending = set(), {'main'} | globals_used(entrypoints[0])
    while pending:
        name = pending.pop()
        if name in needed: continue
        needed.add(name)
        if name in symbols: pending.update(globals_used(symbols[name][1]) - needed)
    selected, emitted_imports = [], set()
    for node in imports:
        names = {a.asname or (a.name.split('.')[0] if isinstance(node, ast.Import) else a.name)
                 for a in node.names}
        code = ast.unparse(node)
        if names & needed and code not in emitted_imports:
            selected.append(code);emitted_imports.add(code)
    previous = None
    for module, node, code in declarations:
        if any(symbols.get(name, (None, None))[1] is node for name in needed):
            if previous != module:
                selected.append('# From specops_delivery/' + module)
                previous = module
            selected.append(code)
    selected.append(ast.unparse(entrypoints[0]))
    result = '\n\n'.join(selected) + '\n'
    compile(result, '<specops-inline>', 'exec')
    return result
