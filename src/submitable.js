import { derived, writable } from "svelte/store";
import { select } from "specma";
import equals from "fast-deep-equal";
import clone from "clone-deep";
import checkable from "./checkable";

const noop = () => {};

export default function submittable(
  initialValue,
  {
    afterSubmit = noop,
    onReset = noop,
    spec,
    selection = false,
    submit = noop,
    active = false,
    ...checkableOptions
  } = {}
) {
  let _initialValue;
  let _value;

  const changed = writable(false);
  const response = writable(undefined);
  const submitting = writable(false);
  const check = checkable(spec, initialValue, { active, ...checkableOptions });
  const inactive = derived(check, ($check) => $check.active === false);

  reset(initialValue);

  function activate(bool) {
    if (!bool) clearResponse();
    return check.activate(bool);
  }

  function clearResponse() {
    response.set(undefined);
  }

  function reset(
    newValue = _initialValue,
    { resetActive = true, resetResponse = true } = {}
  ) {
    _initialValue = select(selection, newValue);

    changed.set(false);
    resetActive && check.activate(active);
    resetResponse && clearResponse();
    check.set(_initialValue);

    _value = clone(_initialValue);

    /* Must be copied to prevent direct reference in Svelte components */
    onReset(_value);
    return _initialValue;
  }

  function set(newValue) {
    const pruned = select(selection, newValue);
    check.set(pruned);
    changed.set(!equals(pruned, _initialValue));
    _value = pruned;
  }

  return {
    activate,
    clearResponse,
    reset,
    set,

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
      response.set();
      const res = await check.activate();

      let resp;
      if (res.valid === true) {
        resp = await submit(_value);
        response.set(interpretResponse(resp));
        afterSubmit(resp, { activate, reset, set });
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
