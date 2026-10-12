export async function api<T>(path:string,init?:RequestInit):Promise<T>{
  const response=await fetch(`/api${path}`,{...init,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new Error(`API ${response.status}`);
  return response.json() as Promise<T>;
}
