// Component interaction checks. Run with MEDISLOT_TEST_RENDERER pointing to
// react-test-renderer 19.1.1 installed outside the application dependencies.
const assert = require("node:assert/strict");
const Module = require("node:module");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const rendererPath = process.env.MEDISLOT_TEST_RENDERER;
assert.ok(rendererPath, "Set MEDISLOT_TEST_RENDERER to the test renderer module directory");
const React = require(require.resolve("react", { paths: [rendererPath] }));
const { create, act } = require(rendererPath);
global.IS_REACT_ACT_ENVIRONMENT = true;

let role = "MANAGER";
let authenticated = true;
const auth = { token: "test-token", role: "MANAGER", userId: 1 };
const requests = [];
let response = { doctorId: 1, timeZone: "Europe/Warsaw", slots: [
  { startTime: "2026-11-20T23:00:00Z", endTime: "2026-11-20T23:30:00Z" },
  { startTime: "2026-07-01T07:00:00Z", endTime: "2026-07-01T07:30:00Z" },
] };
const router = { replace() {}, push() {} };
const originalLoad = Module._load;
Module._load = function (name, parent, ...rest) {
  if (name === "react") return React;
  if (name === "react/jsx-runtime") return require(require.resolve(name, { paths: [rendererPath] }));
  if (name === "next/navigation") return { useRouter: () => router, usePathname: () => "/schedule-generation" };
  if (name === "next/link") return ({ children, ...props }) => React.createElement("a", props, children);
  if (name.endsWith("/useAuth")) return { useAuth: () => ({
    auth: authenticated ? auth : null, role, ready: true, isAuthenticated: authenticated,
    hasRole: (roles) => authenticated && roles.includes(role), logout() {},
  }) };
  if (name.endsWith("/api")) return { apiRequest: async (url, options) => {
    requests.push({ url, options });
    if (url === "/doctors") return { data: [{ id: 1, user: { name: "Test Doctor" } }] };
    if (url === "/schedulePeriods") return { slotCount: 1 };
    if (response instanceof Error) throw response;
    return await response;
  } };
  return originalLoad.call(this, name, parent, ...rest);
};
const previousExtensions = {};
for (const ext of [".ts", ".tsx"]) {
  previousExtensions[ext] = require.extensions[ext];
  require.extensions[ext] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, file);
}
global.FormData = class {
  constructor(data) { this.data = data; }
  get(key) { return this.data[key] ?? ""; }
  getAll(key) { return this.data[key] ?? []; }
};
const Page = require("../app/schedule-generation/page.tsx").default;
let view;
const text = () => JSON.stringify(view.toJSON());
const form = () => view.root.findByType("form");
const values = { doctorId: "1", startDate: "2026-07-01", endDate: "2026-11-21",
  dailyStartTime: "09:00", dailyEndTime: "10:00", duration: "30", weekday: ["1", "5"], excludedDates: "" };
const submit = () => form().props.onSubmit({ preventDefault() {}, currentTarget: values });

(async () => {
  for (const denied of ["DOCTOR", "RECEPTIONIST", "PATIENT", null]) {
    role = denied;
    authenticated = denied !== null;
    const before = requests.length;
    await act(async () => { view = create(React.createElement(Page)); });
    assert.equal(view.root.findAllByType("form").length, 0);
    assert.equal(requests.length, before, "Denied page must not request doctors or preview");
    await act(async () => view.unmount());
  }
  authenticated = true; role = "ADMIN";
  await act(async () => { view = create(React.createElement(Page)); });
  assert.equal(view.root.findAllByType("form").length, 1);
  assert.ok(view.root.findAllByType("a").some((link) => link.props.href === "/schedule-generation"));
  await act(submit);
  assert.match(text(), /Proposed schedule/);
  await act(async () => view.unmount());
  role = "MANAGER";
  await act(async () => { view = create(React.createElement(Page)); });
  assert.equal(form().props.onSubmit instanceof Function, true);
  await act(submit);
  assert.match(text(), /Total: .*2.*included/);
  assert.match(text(), /2026-11-21/); // UTC date crosses midnight in Warsaw.
  assert.match(text(), /00:00/);
  assert.match(text(), /09:00/); // Summer UTC+2.
  let button = view.root.findAllByType("button").find((b) => b.props["aria-label"]?.startsWith("Remove"));
  await act(async () => button.props.onClick());
  assert.match(text(), /Total: .*1.*included/);
  button = view.root.findAllByType("button").find((b) => b.props["aria-label"]?.startsWith("Restore"));
  await act(async () => button.props.onClick());
  assert.match(text(), /Total: .*2.*included/);

  await act(async () => form().props.onChange());
  assert.doesNotMatch(text(), /Proposed schedule/);
  assert.match(text(), /Inputs changed/);

  let resolve;
  response = new Promise((done) => { resolve = done; });
  let pending;
  await act(async () => { pending = submit(); });
  assert.match(text(), /Generating/);
  await act(async () => form().props.onChange());
  await act(async () => { resolve({ doctorId: 1, timeZone: "Europe/Warsaw", slots: [] }); await pending; });
  assert.doesNotMatch(text(), /Proposed schedule/);

  response = { doctorId: 1, timeZone: "Europe/Warsaw", slots: [] };
  await act(submit);
  assert.match(text(), /No full slots match/);
  response = Object.assign(new Error("Bad Request"), { payload: { message: ["Invalid date", "Invalid duration"] } });
  await act(submit);
  assert.match(text(), /Invalid date; Invalid duration/);
  response = { doctorId: 1, timeZone: "Europe/Warsaw", slots: [
    { startTime: "2026-11-20T08:00:00Z", endTime: "2026-11-20T08:30:00Z" },
    { startTime: "2026-11-20T08:30:00Z", endTime: "2026-11-20T09:00:00Z" },
  ] };
  await act(submit);
  const buttonNamed = (name) => view.root.findAllByType("button").find((button) => button.props.children === name);
  const remove = view.root.findAllByType("button").find((button) => button.props["aria-label"]?.startsWith("Remove"));
  await act(async () => remove.props.onClick());
  await act(async () => buttonNamed("Publish schedule").props.onClick());
  assert.match(text(), /Confirm publication/);
  assert.match(text(), /Retained slots: .*1/);
  await act(async () => buttonNamed("Confirm and publish").props.onClick());
  const publication = requests.find(({ url }) => url === "/schedulePeriods");
  assert.deepEqual(publication.options.body, {
    doctorId: 1, startDate: values.startDate, endDate: values.endDate, workingWeekdays: [1, 5],
    dailyStartTime: "09:00", dailyEndTime: "10:00", slotDurationMinutes: 30,
    excludedDates: [], removedSlotIds: [0],
  });
  assert.doesNotMatch(text(), /Proposed schedule/);
  assert.match(text(), /Schedule published successfully/);
  await act(async () => view.unmount());
  console.log("PASS: admin and manager access; other roles denied, Warsaw winter/summer dates and times, counts, removal/restoration, input invalidation, stale-response rejection, loading, empty results, validation errors, publication snapshot/removal indexes/confirmation and success clearing.");
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => {
    Module._load = originalLoad;
    for (const ext of [".ts", ".tsx"]) require.extensions[ext] = previousExtensions[ext];
  });
