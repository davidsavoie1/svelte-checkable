import { derived } from "svelte/store";
import * as s from "specma";
import equal from "fast-deep-equal";
import { defaultMessages, getMessage, setMessages } from "./config";
import mapStore from "./mapStore";
import stateStore from "./stateStore";

const u = s.util;

const INACTIVE = { valid: true, inactive: true };
const PENDING = { valid: null };
const VALID = { valid: true };

const isArray = (x) => Array.isArray(x);
const isColl = (x) => typeof x === "object";
const isInvalidResult = ({ valid }) => ![true, null].includes(valid);
const noop = () => {};

function checkable(
  spec,
  initialValue,
  {
    key: ownKey,
    path: ownPath = [],
    active: initialActive = true,
    context: initialContext,
    isRequired = false,
    messages = defaultMessages,
    require: requirements,
    toKeys = [],
    // CALLBACKS
    onChange = noop,
    onDirty = noop,
    onResult = noop,
    register = noop,
  } = {}
) {
  /* Function used to derive children's key from their initial value.
   * Defined the same way as a spec (including spread). */
  const toKey = s.getPred(toKeys);
  function getSubKey(key, value) {
    if (!toKey) return key;
    return toKey(u.get(key, value));
  }

  /* Wether or not the store has been (or will be on creation) validated at least once. */
  const $active = stateStore(initialActive);
  /* Own predicate result */
  const $check = stateStore(INACTIVE);
  /* Children are ordered subCheckables */
  const $children = stateStore();
  /* Own context */
  const $context = stateStore(initialContext);
  /* Indicates if node or any child has been activated. */
  const $dirty = stateStore(false);
  /* Global result, own and subCheckables' */
  const $result = stateStore(INACTIVE);
  /* `register` used as a callback will ensure that the parent will know
   * about this value and setup a result slot for it. Will also remove the result slot
   * when not subscribed anymore. */
  const $value = stateStore(initialValue, register);

  const $subResults = mapStore();
  const $subCheckables = mapStore();

  /* Combined invalid results errors */
  const $errors = derived([$check, $subResults], ([ownResult, resultsMap]) => {
    return [ownResult, ...resultsMap.values()].reduce(
      (acc, res) => (isInvalidResult(res) ? [...acc, res] : acc),
      []
    );
  });

  let validationId;

  /* Analyse requirements */
  const spreadReq = s.getSpread(requirements);
  const declaredReq = new Map(
    u
      .entries(requirements)
      .filter(([k, req]) => k !== "..." && !!req && !s.isOpt(req))
  );

  /* Initialize store with a reset */
  reset();

  /* FUNCTIONS */

  /* Validate only if not already active */
  function activate() {
    onDirty();
    if (!$active.get()) return validate();
    return Promise.resolve($result.get());
  }

  /* Use parent callback to provide it with latest combined result from own and children */
  function broadcastResult(res) {
    const result = defaultTo(
      analyseResults([$check.get(), ...Array.from($subResults.get().values())]),
      res
    );
    const simplified = simplifyResult(result);
    if (simplified !== $result.get()) {
      $result.set(simplified);
      onResult(simplified);
    }
    return simplified;
  }

  /* Change own value and broadcast the change to ancestors so they update theirs.
   * Revalidate if store is active. */
  function change(value) {
    if (equal(value, $value.get())) return;

    $value.set(value);
    onChange(value);
    if ($active.get()) validate();
  }

  /* Reset manual state stores (unless otherwise specified)
   * then set the value with a complete subCheckables rebuild. */
  function reset(
    value = initialValue,
    { active: resetActive = true, context: resetContext = false } = {}
  ) {
    if (resetActive) $active.reset();
    if (resetContext) $context.reset();

    $result.set(INACTIVE);
    if (isRequired) register();
    set(value, { broadcast: false, rebuild: true });
    $dirty.set(false);
  }

  /* Set a value for the store and update both children and ancestors.
   * If spec is a collection one, create all subCheckables
   * or update them if they exist and rebuild is not requested. */
  function set(value, { broadcast = true, rebuild = false } = {}) {
    if (!rebuild && equal(value, $value.get())) return;

    $value.set(value);
    if (broadcast) onChange(value);

    if (isColl(spec)) {
      updateSubCheckables();
      updateChildren(value);
    }

    /* If active, validate, otherwise, set initial own result as INACTIVE. */
    $active.get() ? validate() : $check.set(INACTIVE);

    // SUB FUNCTIONS
    function updateSubCheckables() {
      const allKeys = combineKeys(value, spec);
      $subCheckables.update(
        allKeys.map((key) => {
          /* If a `getKey` function is provided, it will be used on the initial value to associate
           * the child's key so that integrity can be preserved in a keyed `{#each}` */
          const subKey = getSubKey(key, value);
          const subSpec = u.get(key, spec) || s.getSpread(spec);
          const subToKeys = u.get(key, toKeys) || s.getSpread(toKeys);

          /* If value is supposed to be a collection (as per the spec),
           * but its value is undefined, return an empty instance of spec type. */
          const subVal = defaultTo(emptyValue(subSpec), u.get(key, value));

          return [
            subKey,
            (prev) => {
              /* If no previous store for subKey or if rebuilding entirely */
              if (rebuild || !prev) {
                return checkable(subSpec, subVal, {
                  key: subKey,
                  path: u.mergePaths(ownPath, key),
                  active: $active.get(),
                  isRequired: declaredReq.get(key),
                  messages,
                  require: defaultTo(spreadReq, u.get(key, requirements)),
                  toKeys: subToKeys,
                  /* A subCheckable calling `onChange` will trigger a chain reaction
                   * where each ancestor will update its value and validate if active. */
                  onChange(newSubVal) {
                    const currValue = $value.get();
                    let keyToChange = subKey;
                    if (toKey) {
                      const entries = u.entries(currValue);
                      const entry =
                        entries.find(([, v]) => toKey(v) === subKey) || [];
                      keyToChange = entry[0];
                    }
                    const newVal = u.set(keyToChange, newSubVal, $value.get());
                    change(newVal);
                  },
                  /* A subCheckable calling `onDirty` will trigger a chain reaction
                   * where each ancestor willalso get dirty. */
                  onDirty() {
                    $dirty.set(true);
                    onDirty();
                  },
                  /* A subCheckable can call `onResult` to inform its parent
                   * that its global result (its own combined with its children's) has changed.
                   * Will trigger a chain reaction for all ancestors. */
                  onResult(subResult) {
                    $subResults.setOne(subKey, subResult);
                    broadcastResult();
                  },
                  /* Will be used as the callback to subCheckable's value store.
                   * Will be called on first subscription only.
                   * Returned function will be called after last unsubscribe. */
                  register() {
                    if (!$subResults.get().has(subKey)) {
                      $subResults.setOne(subKey, INACTIVE);
                      register();
                    }
                    return () => $subResults.removeOne(subKey);
                  },
                });
              }

              /* If reusing previous store, set its value, but do not
               * have it broadcast its value change since parent initiated it. */
              prev.set(subVal, { broadcast: false });
              return prev;
            },
          ];
        })
      );
    }
  }

  /* Set a context that will be passed as a second argument to predicate specs. */
  function setContext(context, activate = false) {
    $context.set(context);
    if (activate || $active.get()) validate();
  }

  /* Set the context of the store and its descendants
   * by specifying a context trie in the same manner as a spec.
   * Own context is the return value of a function stored as the predicate. */
  function setContextTrie(contextTrie, activate = false) {
    const contextFn = s.getPred(contextTrie);
    if (contextFn) setContext(contextFn(), activate);

    const spreadSubTrie = s.getSpread(contextTrie);
    u.entries($subCheckables.get()).forEach(([key, subCheckable]) => {
      const subTrie = u.get(key, contextTrie) || spreadSubTrie;
      if (!subTrie) return;
      subCheckable.setContextTrie(subTrie);
    });
  }

  function update(fn, options) {
    const newValue = fn($value.get());
    set(newValue, options);
  }

  /* For each key, get the corresponding subCheckable.
   * If a `childrenKey` is defined, it will be used to retrieve
   * the appropriate one. Return children in the same collection
   * shape as the spec. */
  function updateChildren(value) {
    const subCheckables = $subCheckables.get();
    const allKeys = combineKeys(value, spec);
    $children.set(
      allKeys.reduce((acc, key) => {
        const child = subCheckables.get(getSubKey(key, value));
        return child ? u.set(key, child, acc) : acc;
      }, emptyValue(spec))
    );
  }

  /* Validate will always return a promise, so that it can be used
   * externally to wait for validation to complete. */
  function validate() {
    function enhanceResult(res) {
      return isInvalidResult(res) ? { ...res, path: ownPath } : res;
    }

    function validateOwn() {
      const value = $value.get();
      if (value === undefined) {
        if (isRequired)
          return {
            valid: false,
            reason: getMessage("isRequired", messages),
            path: ownPath,
          };
        return VALID;
      }
      return s.validate(s.getPred(spec), value, { context: $context.get() });
    }

    const currValidation = Date.now();
    validationId = currValidation;

    /* Validate and set own result synchronously */
    const res = enhanceResult(validateOwn());
    const simplified = simplifyResult(res);
    $check.set(simplified);

    /* A call to `validate` always activates the store. */
    $active.set(true);

    /* Resolve own pending result */
    let currPromise = Promise.resolve(simplified);
    if (res.valid === null) {
      currPromise = res.promise;

      res.promise.then((promised) => {
        /* Newer calls to `validate` should prevent previous
         * resolved promises to change the result. */
        if (validationId === currValidation && $active.get()) {
          $check.set(promised);
          currPromise = null;
        }
      });
    }

    /* If some registered subCheckables are still inactive, validate them.
     * Combine all results by racing for the first invalid. */
    const subResults = $subResults.get();
    const subPromises = Array.from($subCheckables.get().entries())
      .filter(([key]) => subResults.has(key))
      .map(([, subCheckable]) => subCheckable.activate());

    const combinedPromise = resultsRace([currPromise, ...subPromises]).then(
      (winner) => {
        if (validationId !== currValidation) return $result.get();
        return broadcastResult(enhanceResult(winner));
      }
    );
    return combinedPromise;
  }

  return {
    key: ownKey,
    path: ownPath,
    isRequired,
    spec,
    // STORES
    active: readOnlyStore($active),
    check: readOnlyStore($check),
    children: readOnlyStore($children),
    context: readOnlyStore($context),
    dirty: readOnlyStore($dirty),
    result: readOnlyStore($result),
    errors: $errors, // Derived
    get: $value.get,
    subscribe: $value.subscribe, // $value is the main returned store
    // METHODS
    activate,
    change,
    reset,
    set,
    setContext,
    setContextTrie,
    update,
    validate,
  };
}

checkable.setMessages = setMessages;

export default checkable;

// HELPERS

function analyseResults(results = []) {
  const firstInvalid = results.find(isInvalidResult);
  if (firstInvalid) return firstInvalid;
  if (results.some((r) => r.valid === null)) return PENDING;
  return VALID;
}

function combineKeys(value, spec) {
  return isArray(spec) ? u.keys(value) : uniqueKeys(value, spec);
}

function defaultTo(defaultValue, value) {
  if ([undefined, null, NaN].includes(value)) return defaultValue;
  return value;
}

function emptyValue(example) {
  const empties = {
    array: [],
    map: new Map(),
    object: {},
  };
  return empties[u.typeOf(example)];
}

function readOnlyStore(store) {
  return { get: store.get, subscribe: store.subscribe };
}

function simplifyResult(res) {
  if (res.valid === true) return res.inactive ? INACTIVE : VALID;
  if (res.valid === null) return PENDING;
  return res;
}

function resultsRace(resultPromises) {
  return Promise.all(
    resultPromises.map((promise) => {
      return promise.then((promisedRes) => {
        if (promisedRes.valid === true) return promisedRes;
        throw promisedRes;
      });
    })
  )
    .then(() => ({ valid: true }))
    .catch((result) => result);
}

function uniqueKeys(...colls) {
  return Array.from(new Set(colls.flatMap(u.keys)));
}
