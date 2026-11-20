const assert=require('node:assert/strict');const fs=require('node:fs');const Module=require('node:module');const ts=require('typescript');const path=require('node:path');
const file=path.resolve(__dirname,'../app/lib/specializations.ts');
const compiled=new Module(file,module);compiled.filename=file;compiled.paths=module.paths;
compiled._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const {SPECIALIZATIONS,specializationLabel,specializationOptions}=compiled.exports;
assert.deepEqual(Object.keys(SPECIALIZATIONS),['GENERAL_PRACTICE','CARDIOLOGY','NEUROLOGY','ORTHOPAEDICS','PEDIATRICS','DERMATOLOGY','OPHTHALMOLOGY','ENT','GYNAECOLOGY','UROLOGY']);
assert.equal(specializationLabel(null),'Not specified');assert.equal(specializationLabel(undefined),'Not specified');assert.equal(specializationLabel('ENT'),'Ear, nose and throat');
for(const [value,label] of specializationOptions){assert.equal(specializationLabel(value),label);assert.notEqual(value,label)}
console.log('PASS: all specialization options/readable labels, ENT and missing values');
