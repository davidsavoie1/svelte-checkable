import { derived, writable } from "svelte/store";
import { select } from "specma";
import equals from "fast-deep-equal";
import clone from "clone-deep";
import checkable from "./checkable";

const noop = () => {};

export default function submittable(
  initialValue,
  {
    onReset = noop,
    spec,
    selection = false,
    submit = noop,
    active = false,
    ...checkableOptions
  } = {}
) {
  let _initialValue = select(selection, initialValue);
  let _value = _initialValue;

  const changed = writable(false);
  const response = writable(undefined);
  const submitting = writable(false);
  const check = checkable(spec, initialValue, { active, ...checkableOptions });
  const inactive = derived(check, ($check) => $check.active === false);

  return {
    activate: check.activate,

    reset: (newValue = _initialValue) => {
      _initialValue = select(selection, newValue);

      changed.set(false);
      check.activate(active);
      response.set(undefined);
      check.set(_initialValue);

      _value = _initialValue;

      /* Must be copied to prevent direct reference in Svelte components */
      onReset(clone(_initialValue));
      return _initialValue;
    },

    set(newValue) {
      const pruned = select(selection, newValue);
      check.set(pruned);
      changed.set(!equals(pruned, _initialValue));
      _value = pruned;
    },

    status: derived(
      [changed, inactive, response, submitting],
      ([$changed, $inactive, $response, $submitting]) => {
        return {
          changed: $changed,
          inactive: $inactive,
          response: $response,
          submitting: $submitting,
          touched: $changed || !$inactive || $response !== undefined,
        };
      }
    ),

    submit: async () => {
      submitting.set(true);
      response.set({});
      const res = await check.activate();

      let resp;
      if (res.valid === true) {
        resp = await submit(_value);
        response.set(interpretResponse(resp));
      }
      submitting.set(false);
      return resp;
    },

    subscribe: check.subscribe,
  };
}

/* Interpret submit response to return an object
 * of shape { type: <success|info|error|warning>, message: <string> } */
function interpretResponse(resp) {
  if (!resp || resp === true) return undefined;
  if (typeof resp === "object") return resp;
  return { type: undefined, message: resp };
}
