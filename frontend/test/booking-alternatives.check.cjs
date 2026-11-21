// Exercise the actual recovery trigger without rendering or installing extra test dependencies.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const file=path.resolve(__dirname,'../app/components/BookingAlternatives.tsx');
const originalLoad=Module._load;
Module._load=function(name,parent,...rest){
 if(parent?.filename===file&&['../lib/api','../lib/clinicTime','../lib/useClinicTimeNotice','./AppShell'].includes(name))return{};
 return originalLoad.call(this,name,parent,...rest);
};
try{
 const compiled=new Module(file,module);compiled.filename=file;compiled.paths=Module._nodeModulePaths(path.dirname(file));
 compiled._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,file);
 const trigger=compiled.exports.isSlotUnavailable;
 assert.equal(trigger(Object.assign(new Error('Taken'),{status:409,payload:{code:'SLOT_UNAVAILABLE'}})),true);
 for(const error of [null,undefined,new TypeError('Failed to fetch'),{status:400,payload:{code:'SLOT_UNAVAILABLE'}},{status:409,payload:{code:'CONFLICT'}},{status:404,payload:{code:'NOT_FOUND'}},{status:409,payload:null},{status:409,payload:'SLOT_UNAVAILABLE'}])assert.equal(trigger(error),false);
 console.log('PASS: only HTTP 409/SLOT_UNAVAILABLE triggers booking recovery; validation, patient conflict, missing-slot and ambiguous network failures do not.');
}finally{Module._load=originalLoad}
