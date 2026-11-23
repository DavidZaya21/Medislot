import assert from "node:assert/strict";
import test from "node:test";
import { MailpitTransport } from "../src/email/mailpit-transport";
import { EmailFailure, TOTAL_ATTEMPTS, retryDelay } from "../src/email/policy";

test("capture transport rejects external hosts/ports and real recipient addresses before SMTP", async () => {
  for (const [host, port] of [["smtp.example.com",587],["127.0.0.1",25],["mailpit",465]] as const) assert.throws(() => new MailpitTransport(host,port));
  const transport=new MailpitTransport("127.0.0.1",1025);
  await assert.rejects(()=>transport.send({to:"real@gmail.com",subject:"test",text:"test",messageId:"test"}),error=>error instanceof EmailFailure&&error.kind==="CAPTURE_REJECTED");
  assert.equal(TOTAL_ATTEMPTS,3);assert.equal(retryDelay(1),60000);assert.equal(retryDelay(2),300000);
});
test("only definite recipient rejection is permanent; SMTP timeouts remain ambiguous", async () => {
  for (const [failure,kind] of [[{command:"RCPT TO",responseCode:550},"PERMANENT_RECIPIENT"],[{command:"RCPT TO",responseCode:450},"TEMPORARY"],[{code:"ETIMEDOUT"},"AMBIGUOUS"],[{code:"ESOCKET"},"AMBIGUOUS"]] as const) {
    const transport=new MailpitTransport("127.0.0.1",1025);
    Reflect.set(transport,"smtp",{sendMail:async()=>{throw failure}});
    await assert.rejects(()=>transport.send({to:"test@example.test",subject:"test",text:"test",messageId:"test"}),error=>error instanceof EmailFailure&&error.kind===kind);
  }
});
