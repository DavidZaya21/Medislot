// Test-only clock; never imported by the application. Strict disposable-target guard.
require('reflect-metadata');const assert=require('node:assert/strict'),path=require('node:path');
const url=new URL(process.env.DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/medislot_frontend_reschedule_test');
const {NestFactory}=require('@nestjs/core'),{ValidationPipe}=require('@nestjs/common');const root=process.env.MEDISLOT_COMPILED_API;assert.ok(root);
(async()=>{const {AppModule}=require(path.join(root,'app.module.js')),{FollowUpsService}=require(path.join(root,'follow-ups/follow-ups.service.js'));
 const app=await NestFactory.create(AppModule,{logger:false});app.enableCors();app.useGlobalPipes(new ValidationPipe({transform:true,whitelist:true}));
 const now=new Date(Date.now()+2*86400000),date=now.toISOString().slice(0,10);app.get(FollowUpsService).clock=()=>new Date(date+'T11:00:00Z');
 await app.listen(Number(process.env.BACKEND_PORT));})().catch(e=>{console.error(e);process.exit(1)});
