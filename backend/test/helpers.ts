export function createSpy<Args extends unknown[], Result>(
  implementation: (...args: Args) => Result,
) {
  const calls: Args[] = [];

  return {
    calls,
    fn: (...args: Args) => {
      calls.push(args);
      return implementation(...args);
    },
  };
}
