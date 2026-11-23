const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const file=path.resolve(__dirname,'../app/lib/appointmentViews.ts'),m=new Module(file,module);m.filename=file;m.paths=module.paths;m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const view=m.exports.appointmentView,now=Date.parse('2030-01-07T10:00:00Z');
for(const [status,start,end,expected] of [
 ['CONFIRMED',now+1,now+2,'Upcoming'],['CONFIRMED',now-1,now+1,'Upcoming'],['CONFIRMED',now-2,now,'Past'],
 ['NEEDS_RESCHEDULING',now-2,now-1,'Needs rescheduling'],['NEEDS_RESCHEDULING',now+1,now+2,'Needs rescheduling'],
 ['CANCELLED',now-2,now-1,'Cancelled'],['CANCELLED',now+1,now+2,'Cancelled'],
 ['COMPLETED',now-2,now-1,'Past'],['NO_SHOW',now-2,now-1,'Past'],
]) {const appointment={status,slotStartTime:new Date(start).toISOString(),slotEndTime:new Date(end).toISOString()},before=JSON.stringify(appointment);assert.equal(view(appointment,now),expected);assert.equal(JSON.stringify(appointment),before);}
console.log('PASS: view precedence, in-progress and exact end-time boundary; no status mutation.');
