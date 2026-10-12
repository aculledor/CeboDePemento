import { openDatabase, migrate, backupDatabase } from './database.js';
const store=openDatabase();
try{
  switch(process.argv[2]){
    case 'migrate':await migrate(store);console.log('Migraciones aplicadas.');break;
    case 'backup':console.log(await backupDatabase(store));break;
    default:throw new Error('Use migrate or backup');
  }
}finally{store.sqlite.close();}
