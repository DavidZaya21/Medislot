const API = "http://localhost:4000";

const tokenA = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjI3LCJyb2xlIjoiUEFUSUVOVCIsImlhdCI6MTc4ODc0NTUxNiwiZXhwIjoxNzg5MzUwMzE2fQ.RZUq5VKwaNEfa52iMt_I3Gg_qPFrc2NEGo4B6Q16YFw";
const tokenB = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjI4LCJyb2xlIjoiUEFUSUVOVCIsImlhdCI6MTc4ODc0NTU1MSwiZXhwIjoxNzg5MzUwMzUxfQ.HRb92QkWmrKxnLiYoZgQ2f0cxX8D3MIQTfzDFzaZK04";

const doctorId = 15;
const calendarId = 6;

async function book(token, label) {
  const started = Date.now();

  const response = await fetch(`${API}/appointments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      doctorId,
      calendarId,
      reason: `Concurrency test ${label}`,
    }),
  });

  const body = await response.text();

  return {
    label,
    status: response.status,
    durationMs: Date.now() - started,
    body,
  };
}

const results = await Promise.all([
  book(tokenA, "A"),
  book(tokenB, "B"),
]);

console.log(results);