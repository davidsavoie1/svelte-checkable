import { tick } from "svelte";
import { derived, writable } from "svelte/store";
import { util, validatePred } from "specma";

const { getPath } = util;

const alwaysTrue = () => true;
const defaultGetFrom = () => undefined;

const VALID = { valid: true, promise: Promise.resolve({ valid: true }) };

export default function predCheckable(
  spec = alwaysTrue,
  initialValue,
  {
    active: initialActive = true,
    key,
    path = [],
    rootValue: initialRootValue,
  } = {}
) {
  const usesGetFrom = spec.length !== 1;

  const active = writable(initialActive);
  const rootValue = writable(initialRootValue);
  const value = writable(initialValue);
  let promise;

  let validationId;
  const derivedFromStores = usesGetFrom
    ? [active, value, rootValue]
    : [active, value];

  const derivedResult = derived(
    derivedFromStores,
    ([$active, $value, $rootValue], set) => {
      function publish(res) {
        promise = res.promise;
        set({ ...res, active: $active, activate });
      }

      if (!$active) {
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

/* Given a value and a current path, return the sub value
 * at a path relative to current one. */
function getFromValue(relPath, currPath = [], value) {
  const newPath = relPath.split("/").reduce((acc, move) => {
    if ([null, undefined, "", "."].includes(move)) return acc;

    if (move.startsWith("..")) return acc.slice(0, -1);

    const index = parseInt(move, 10);
    return [...acc, isNaN(index) ? move : index];
  }, currPath);
  return getPath(newPath, value);
}
