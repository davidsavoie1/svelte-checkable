import * as s from "specma";
import { derived, get, writable } from "svelte/store";
import { alwaysTrue, PENDING, VALID } from "./constants";
import {
  checkCollType,
  cleanResult,
  composeValueAndPred,
  identity,
  typeOf,
  union,
} from "./helpers";

const {
  fromEntries,
  getCollItem,
  getDeclaredEntries,
  getEntries,
  getKeys,
  getKeySpec,
  getPred,
  getSpread,
  isColl,
  isOpt,
  setCollItem,
} = s.helpers;

const defaultMessages = { isRequired: "is required" };

export default function checkable(spec, initialValue, options) {
  const store = isColl(spec) ? collCheckable : predCheckable;
  return store(spec, initialValue, options);
}

function collCheckable(
  spec,
  initialValue,
  {
    key: globalKey,
    active: initiallyActive = true,
    require: requirements,
    isRequired = false,
    messages = defaultMessages,
  } = {}
) {
  const spreadReq = getSpread(requirements);
  const declaredReqEntries = getDeclaredEntries(requirements);
  const requiredSpec = fromEntries(
    typeOf(spec),
    getEntries(spec).filter(([key]) => {
      const subReq = declaredReqEntries.find(([k]) => k === key);
      const isReq = subReq && subReq[1];
      return !!isReq && !isOpt(isReq);
    })
  );

  const initialComposedValue = composeValueAndPred(initialValue, spec);
  const subCheckables = new Map();

  let currActive = initiallyActive;
  const activeByKeyStore = writable(new Map());
  const activeStore = derived(activeByKeyStore, (activesMap) => {
    const activeFlags = [...activesMap.values()];
    if (activeFlags.length <= 0) return initiallyActive;

    currActive = activeFlags.reduce((acc, flag) => {
      if (acc !== flag) return null;
      return acc || flag;
    });
    return currActive;
  });

  /* Container to put new collection value at once.
   * Will update/create each `subCheckable`. Different than `ownCheckable.value`,
   * because subscribing to this one would trigger an action each time
   * a `subCheckable` updates its values. */
  const newValueStore = writable(initialComposedValue);

  /* `orderStore` and `childrenStore` work together to create ordered children. */
  const orderStore = writable(getKeys(initialComposedValue));
  const childrenStore = derived(orderStore, (orderedKeys) =>
    fromEntries(
      typeOf(spec),
      orderedKeys
        .filter((key) => subCheckables.has(key))
        .map((key) => [key, subCheckables.get(key)])
    )
  );

  /* Results are stored in a key-value Map for easy access and key type integrity */
  const resultsStore = writable(new Map());
  let currResult = undefined;

  /* All subscriptions to inner stores will save unsubscribe handler here for global unsub.
   * Keyed in a Map for easy specific unsubscribe. */
  const unsubs = new Map();

  /* All external subscriptions to the store will be saved here
   * to update them and unsubscribe them when all done. */
  const subscriptions = new Set();

  /* Add a collection type check pred spec */
  const pred = s.and(getPred(spec), checkCollType(typeOf(spec)));
  const ownCheckable = predCheckable(pred, initialComposedValue, {
    active: initiallyActive,
    isRequired,
    messages,
  });

  initSubscriptions();

  function initSubscriptions() {
    /* Track results changes. Recalculate global result
     * and publish it to all subscribers if it has changed. */
    unsubs.set(
      resultsStore,
      resultsStore.subscribe((results) => {
        const result = analyseResults(results);

        /* Republish only if result has changed */
        if (result !== currResult) {
          currResult = result;
          subscriptions.forEach((publish) =>
            publish(cleanResult(result, globalKey))
          );
        }
      })
    );

    /* Track own predicate result to store it as the `undefined` key. */
    unsubs.set(
      ownCheckable.check,
      ownCheckable.check.subscribe((ownResult) =>
        resultsStore.update((prev) => prev.set(undefined, ownResult))
      )
    );

    /* If subCheckables active flags converge to active or partially active (`null`),
     * activate `ownCheckable`. */
    unsubs.set(
      activeStore,
      activeStore.subscribe((isActive) =>
        ownCheckable.active(isActive === false ? false : true)
      )
    );

    /* Track a new value being set. */
    unsubs.set(
      newValueStore,
      newValueStore.subscribe((newValue) => {
        if (!newValue) return;
        ownCheckable.value.reset(newValue);

        const keys = getKeys(newValue);

        /* Unregister all `subCheckables` not included in the value anymore. */
        for (const key of subCheckables.keys()) {
          if (!keys.includes(key)) unregisterSubCheckable(key);
        }

        /* Register (update or create) a `subCheckable` for each value key. */
        getEntries(newValue).forEach(registerSubCheckable);

        /* Reset keys order */
        orderStore.set(keys);
      })
    );
  }

  function analyseResults(results) {
    const entries = getEntries(results);

    /* Return invalid entry as soon as detected */
    const failedEntry = entries.find(([, res]) => res.valid === false);
    if (failedEntry) return failedEntry[1];

    /* If no invalid, but some entries still pending, return pending result. */
    const pendingEntry = entries.find(([, res]) => res.valid === null);
    if (pendingEntry) return PENDING;

    return VALID;
  }

  function registerSubCheckable([key, value]) {
    if (subCheckables.has(key)) {
      /* If subCheckable already exists, use it and set its value */
      const subCheckable = subCheckables.get(key);
      subCheckable.value.reset(value);
    } else {
      /* Otherwise, create a new one, register it and setup its subscriptions */
      const spreadSpec = getSpread(spec);

      const subReq = getCollItem(key, requirements) || spreadReq;
      const subSpec = getCollItem(key, spec) || spreadSpec || alwaysTrue;
      const currActive = active();

      const subCheckable = checkable(subSpec, value, {
        key,
        active: currActive === null ? initiallyActive : currActive,
        require: subReq,
        isRequired: !!getCollItem(key, requiredSpec),
        messages,
      });
      subCheckables.set(key, subCheckable);

      /* Subscribe to value change */
      unsubs.set(
        subCheckable.value,
        subCheckable.value.subscribe((subValue) => {
          ownCheckable.value((prev) => setCollItem(key, subValue, prev));
        })
      );

      /* Subscribe to results change */
      unsubs.set(
        subCheckable.check,
        subCheckable.check.subscribe((subRes) => {
          resultsStore.update((prev) => prev.set(key, subRes));
        })
      );

      /* Subscribe to active change */
      unsubs.set(
        subCheckable.active,
        subCheckable.active.subscribe((subActive) => {
          activeByKeyStore.update((prev) => prev.set(key, subActive));
        })
      );
    }
  }

  function unregisterSubCheckable(key) {
    const subCheckable = subCheckables.get(key);

    /* Unsubscribe from result, value and active changes */
    [
      unsubs.get(subCheckable.value),
      unsubs.get(subCheckable.check),
      unsubs.get(subCheckable.active),
    ].forEach((unsub) => unsub && unsub());

    [resultsStore, activeByKeyStore].forEach((store) =>
      store.update((prev) => {
        prev.delete(key);
        return prev;
      })
    );
    subCheckables.delete(key);
  }

  /* `active` us a getter/setter function, but also acts as a Svelte store
   * by exposing at least a `subscribe` method. */
  function active() {
    if (arguments.length <= 0) return currActive;

    const nowActive = !!arguments[0];
    subCheckables.forEach((subCheckable) => subCheckable.active(nowActive));
  }
  active.subscribe = activeStore.subscribe;
  active.set = active;
  active.toggle = () => active(!active());

  const check = {
    subscribe(publish) {
      publish(currResult);
      subscriptions.add(publish);

      return () => {
        if (subscriptions.has(publish)) subscriptions.delete(publish);
        if (subscriptions.size <= 0) unsubs.forEach((unsub) => unsub());
      };
    },
  };

  function children() {
    return get(childrenStore);
  }
  children.subscribe = childrenStore.subscribe;

  function reorder(newOrder) {
    const currValue = ownCheckable.value();
    const valueKeys = getKeys(currValue);
    const filteredNewOrder = newOrder.filter((key) => valueKeys.includes(key));
    const orderedKeys = union(filteredNewOrder, valueKeys);

    const newValue = fromEntries(
      typeOf(spec),
      orderedKeys.map((key) => [key, subCheckables.get(key).value()])
    );

    ownCheckable.value.reset(newValue, { resetActive: false });
    orderStore.set(orderedKeys);
  }

  /* If store is not active, activate it so that validation occurs.
   * Return a promise that will resolve when valid is not `null`. */
  function validate() {
    if (!active()) active(true);
    return new Promise((resolve) => {
      let unsub;
      unsub = check.subscribe(({ valid }) => {
        if (valid === null) return;
        resolve(valid);
        unsub && unsub();
      });
    });
  }

  function value() {
    if (arguments.length <= 0) return ownCheckable.value(); // Getter

    const arg = arguments[0];
    const newValue =
      typeOf(arg) === "function" ? arg(ownCheckable.value()) : arg;
    const composed = composeValueAndPred(newValue, spec);
    newValueStore.set(composed); // Setter
  }
  value.subscribe = ownCheckable.value.subscribe;
  value.reset = (newValue = initialValue, { resetActive = true } = {}) => {
    value(newValue);
    resetActive && active(initiallyActive);
  };
  value.set = value;
  value.update = value;

  return {
    active,
    check,
    children,
    context: ownCheckable.context,
    isRequired,
    key: globalKey,
    reorder,
    reset: value.reset,
    set: value.set,
    spec,
    subscribe: value.subscribe,
    update: value.update,
    validate,
    value,
  };
}

// === predCheckable ===

function predCheckable(
  spec,
  initialValue,
  {
    key: globalKey,
    active: initiallyActive = true,
    isRequired = false,
    messages = defaultMessages,
  } = {}
) {
  let currActive = initiallyActive;
  /* Context can be assigned by `setContext` method. Applicable to pred spec only. */
  let currContext;
  let currInput;
  let currResult;
  let currValue = initialValue;

  const lenses = { fromValue: identity, toValue: identity };
  const inputStore = writable(lenses.fromValue(initialValue));
  const activeStore = writable(initiallyActive);
  const contextStore = writable();
  const valueStore = writable(initialValue, (setValue) => {
    const unsub = inputStore.subscribe((input) => {
      currInput = input;
      setValue(lenses.toValue(input));
    });
    return unsub;
  });

  const resultStore = derived(
    [activeStore, valueStore, contextStore],
    ([isActive, value, context], set) => {
      /* Copy to local variables for direct access */
      currActive = isActive;
      currValue = value;
      currContext = context;

      if (!isActive) {
        setResult(VALID);
        return;
      }

      if (!isRequired && value === undefined) {
        setResult(VALID);
        return;
      }

      if (isRequired) {
        if ([undefined, null, ""].includes(currValue)) {
          setResult({
            valid: false,
            reason: getMessage("isRequired", messages),
          });
          return;
        }
      }

      let result = s.validate(spec, value, { context });

      const keySpec = getKeySpec(spec);
      if (keySpec) {
        const keyResult = s.validate(keySpec, globalKey, { context });
        result = interpretResults(result, keyResult);
      }

      setResult(result);

      /* If result is async, set result after resolution only if value did not change in the meantime */
      if (result.valid === null) {
        result.promise.then((promisedResult) => {
          if (value === currValue) setResult(promisedResult);
        });
      }

      function interpretResults(...results) {
        const firstInvalid = results.find((res) => res.valid === false);
        if (firstInvalid) return firstInvalid;

        if (results.every((res) => res.valid === true)) return VALID;

        /* If there is any promise answer, return a global promise
         * that will resolve at the first invalid answer
         * or when all promises have resolved. */
        const promise = new Promise((resolve) => {
          const promises = results
            .map((res) => res.promise)
            .filter((x) => x && typeof x.then === "function");

          promises.forEach((promise) =>
            promise.then((res) => {
              if (res.valid !== true) resolve(res);
            })
          );

          Promise.all(promises).then((promisedResults) =>
            resolve(interpretResults(...promisedResults))
          );
        });
        return { ...PENDING, promise };
      }

      /* Set new result only if it changed. */
      function setResult(result) {
        const cleaned = cleanResult(result, globalKey);
        if (cleaned === currResult) return;

        currResult = cleaned;
        set(cleaned);
      }
    }
  );

  /* `active` us a getter/setter function, but also acts as a Svelte store
   * by exposing at least a `subscribe` method. */
  function active() {
    if (arguments.length <= 0) return currActive;
    activeStore.set(!!arguments[0]);
  }
  active.subscribe = activeStore.subscribe;
  active.set = activeStore.set;
  active.toggle = () => activeStore.update((prev) => !prev);

  function context() {
    if (arguments.length <= 0) return currContext; // Getter
    contextStore.set(arguments[0]); // Setter
  }

  /* Create an input store that can transform value to and from input.
   * `input.lenses` function can  be used to define these transformation functions (lenses).
   * Value is always updated by input change (see callback in `valueStore`),
   * but input is updated only if `refresh` method is called (including when value is reset). */
  function input() {
    if (arguments.length <= 0) return currInput; // Getter

    const arg = arguments[0];
    currInput = typeOf(arg) === "function" ? arg(currInput) : arg;
    inputStore.set(currInput); // Setter
  }
  input.refresh = (newValue) => input(lenses.fromValue(newValue));
  input.lenses = function () {
    if (arguments.length <= 0) return lenses;

    const newLenses = arguments[0] || {};

    if ("fromValue" in newLenses) {
      lenses.fromValue = newLenses.fromValue || identity;
      input(lenses.fromValue(value()));
    }

    if ("toValue" in newLenses) {
      /* If `toValue` changes, update value with current transformed input. */
      lenses.toValue = newLenses.toValue || identity;
      value(lenses.toValue(currInput));
    }
  };
  input.set = input;
  input.subscribe = inputStore.subscribe;
  input.update = input;

  /* If store is not active, activate it so that validation occurs.
   * Return a promise that will resolve when valid is not `null`. */
  function validate() {
    if (!active()) active(true);
    return new Promise((resolve) => {
      let unsub;
      unsub = resultStore.subscribe(({ valid }) => {
        if (valid === null) return;
        resolve(valid);
        unsub && unsub();
      });
    });
  }

  /* `value` is a getter/setter function, but also acts as a Svelte store
   * by exposing at least a `subscribe` method. */
  function value() {
    if (arguments.length <= 0) return currValue; // Getter

    const arg = arguments[0];
    const setter =
      typeOf(arg) === "function" ? valueStore.update : valueStore.set;
    setter(arg); // Setter
  }
  value.reset = (newValue, { resetActive = true } = {}) => {
    value(newValue);
    currValue = newValue;
    input.refresh(newValue);
    resetActive && active(initiallyActive);
  };
  value.subscribe = valueStore.subscribe;
  value.set = value;
  value.update = value;

  return {
    active,
    check: resultStore,
    context,
    key: globalKey,
    input,
    isRequired,
    reset: value.reset,
    set: value.set,
    spec,
    subscribe: value.subscribe,
    update: value.update,
    validate,
    value,
  };
}

function setMessages(messages) {
  Object.assign(defaultMessages, messages);
}

function getMessage(key, messages) {
  return messages[key] || defaultMessages[key];
}

checkable.setMessages = setMessages;
