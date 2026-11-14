const API = "http://localhost:4000";

const doctorId = 15;
const calendarId = 6;

const runId = Date.now();

const users = Array.from({ length: 10 }, (_, i) => ({
  name: `LoadTest${i + 1}`,
  email: `loadtest${i + 1}-${runId}@example.com`,
  password: `testing${i + 1}123`,
}));

async function register(user) {
  const response = await fetch(`${API}/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: user.name,
      email: user.email,
      password: user.password,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Registration failed for ${user.email}: ${response.status} ${await response.text()}`
    );
  }
}

async function login(user) {
  const response = await fetch(`${API}/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: user.email,
      password: user.password,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Login failed for ${user.email}: ${response.status} ${await response.text()}`
    );
  }

  const data = await response.json();
  return data.accessToken;
}

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

console.log("Creating 10 test patients...");

for (const user of users) {
  await register(user);
}

console.log("Logging in 10 patients...");

const tokens = await Promise.all(users.map(login));

console.log("Sending 10 concurrent booking requests...");

const results = await Promise.all(
  tokens.map((token, index) =>
    book(token, `User-${index + 1}`)
  )
);

console.log("\nRESULTS:");
console.log(results);

const summary = results.reduce((acc, result) => {
  acc[result.status] = (acc[result.status] || 0) + 1;
  return acc;
}, {});

console.log("\nSUMMARY:");
console.log(summary);