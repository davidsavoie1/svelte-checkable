import { tick } from "svelte";
import { derived, writable } from "svelte/store";
import { validatePred } from "specma";
import { alwaysTrue, defaultGetFrom, getFromValue } from "./helpers";
import { VALID } from "./constants";

export default function predCheckable(
  spec = alwaysTrue,
  initialValue,
  {
    active: initialActive = true,
    key,
    path = [],
    required = false,
    rootValue: initialRootValue,
  } = {}
) {
  const usesGetFrom = spec.length !== 1;

  const active = writable(initialActive);
  const rootValue = writable(initialRootValue);
  const value = writable(initialValue);
  let promise = Promise.resolve(VALID);

  let validationId;
  const derivedFromStores = usesGetFrom
    ? [active, value, rootValue]
    : [active, value];

  const derivedResult = derived(
    derivedFromStores,
    ([$active, $value, $rootValue], set) => {
      function publish(res) {
        promise = res.promise || Promise.resolve(res);
        set({ ...res, active: $active, activate });
      }

      if (!$active || (!required && $value === undefined)) {
        return publish(VALID);
      }

      const getFrom = usesGetFrom
        ? function (relPath) {
            return getFromValue(relPath, path, $rootValue);
          }
        : defaultGetFrom;

      const currValidation = Date.now();
      validationId = currValidation;

      const result = validatePred(spec, $value, getFrom, { key });
      publish(result);

      if (result.valid === null)
        result.promise.then((promised) => {
          if (currValidation === validationId) publish(promised);
        });
    },
    VALID
  );

  async function activate(bool = true) {
    active.set(!!bool);
    await tick();
    return promise;
  }

  function set(newValue, newRootValue) {
    value.set(newValue);
    rootValue.set(newRootValue);
  }

  return {
    activate,
    key,
    set,
    subscribe: derivedResult.subscribe,
    update: value.update,
  };
}
