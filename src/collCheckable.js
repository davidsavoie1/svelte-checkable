import { tick } from "svelte";
import { writable } from "svelte/store";
import { and, getMessage, getPred, getSpread, isOpt, util } from "specma";
import collDerived from "./collDerived";
import predCheckable from "./predCheckable";

const { mergePaths } = util;

const VALID = { valid: true, promise: Promise.resolve({ valid: true }) };

/* MAIN */

export default function collCheckable(
  spec,
  initialValue,
  {
    active: initialActive = true,
    indexBy,
    key: ownKey,
    messages,
    path = [],
    required = false,
    rootValue: initialRootValue,
  } = {},
  checkable
) {
  let active = initialActive;
  let promise;
  let storesMap = new Map();
  const checkables = writable(storesMap);

  updateStoresMap(
    initialValue,
    ownKey === undefined ? initialValue : initialRootValue
  );

  function updateStoresMap(newValue, rootValue) {
    let ownEntry = storesMap.get(null);
    if (ownEntry) {
      ownEntry.set(newValue, rootValue);
    } else {
      const ownSpec = getPred(spec);

      storesMap.set(
        null,
        predCheckable(ownSpec, newValue, {
          active,
          key: ownKey,
          path,
          messages,
          rootValue: rootValue,
        })
      );
    }

    const ownIndexBy = getPred(indexBy);
    const allKeys = new Set([...keys(newValue), ...keys(spec)]);
    const actKeys = new Set();

    allKeys.forEach((key) => {
      const subVal = get(key, newValue);
      const actKey = ownIndexBy ? ownIndexBy(subVal, key) : key;
      actKeys.add(actKey);

      if (storesMap.has(actKey)) {
        const subStore = storesMap.get(actKey);
        subStore.set(subVal, rootValue);
        return;
      }

      const subIndexBy = get(key, indexBy) || getSpread(indexBy);
      const subRequired = getSubRequired(key, required);
      const subSpec = getSpec({
        key,
        spec,
        value: subVal,
        messages,
        required: subRequired,
      });

      storesMap.set(
        actKey,
        checkable(subSpec, subVal, {
          active,
          indexBy: subIndexBy,
          key: actKey,
          messages,
          path: mergePaths(path, key),
          required: subRequired,
          rootValue: rootValue,
        })
      );
    });

    /* Remove unused keys */
    storesMap.forEach((store, key) => {
      if ([null, undefined].includes(key)) return;
      if (!actKeys.has(key)) storesMap.delete(key);
    });

    checkables.set(storesMap);
  }

  const derived = collDerived(storesMap, function combineResults($storesMap) {
    const results = [...$storesMap.values()];
    const pendings = mapOnMap((res) => res.valid === null, $storesMap);

    function enhanceResult(result) {
      const children = $storesMap;
      children.activate = (key) => {
        const store = storesMap.get(key);
        if (store) store.activate();
      };

      const active = combineActives(results.map((res) => res.active));

      const ans = {
        ...result,
        active,
        activate,
        children,
        pendings,
      };
      promise = result.promise || Promise.resolve(ans);
      return { ...ans, promise };
    }

    /* All valid */
    if (results.every((res) => res.valid === true)) {
      return enhanceResult(VALID);
    }

    /* Some pending */
    if (results.some((res) => res.valid === null)) {
      return enhanceResult({ valid: null, promise: resultsRace(results) });
    }

    /* No pending, but not all valid */
    const firstInvalid = results.find((res) => res.valid === false);
    return enhanceResult(firstInvalid);
  });

  async function activate(bool = true) {
    active = !!bool;
    storesMap.forEach((store) => store.activate(active));
    await tick();
    return promise;
  }

  function set(newValue, rootValue) {
    updateStoresMap(newValue, ownKey === undefined ? newValue : rootValue);
    derived.set(storesMap);
  }

  return {
    activate,
    checkables,
    key: ownKey,
    set,
    subscribe: derived.subscribe,
  };
}

/* HELPERS */

function alwaysTrue() {
  return true;
}

function combineActives(actives = []) {
  if (actives.length <= 0) return undefined;
  return actives.reduce((a, b) => (a !== b ? undefined : b));
}

const typeOf = (obj) =>
  ({}.toString.call(obj).split(" ")[1].slice(0, -1).toLowerCase());

function passFailAsync(result) {
  return result.promise.then((promisedRes) => {
    if (promisedRes.valid === true) return promisedRes;
    throw promisedRes;
  });
}

function resultsRace(results) {
  return Promise.all(results.map(passFailAsync))
    .then(() => VALID)
    .catch((result) => result);
}

function get(key, coll) {
  if (typeOf(coll) === "map") return coll.get(key);
  return typeof coll === "object" ? coll[key] : undefined;
}

function getSubRequired(key, required) {
  if (typeof required !== "object") return required;
  return get(key, required) || required["..."];
}

function getSpec({ key, spec, value, messages, required }) {
  const req = isRequired(required);

  if (value === undefined && !req) return alwaysTrue;

  const basicSpec = get(key, spec) || getSpread(spec) || alwaysTrue;
  if (!req) return basicSpec;

  const reqSpec = (x) =>
    ![undefined, null, ""].includes(x) || getMessage("isRequired", messages);
  return and(reqSpec, basicSpec);
}

function isRequired(requirement) {
  if (typeof requirement !== "object") return !!requirement;
  return requirement && !isOpt(requirement);
}

function keys(coll, indexBy = (v, k) => k) {
  const fn = {
    array: () => coll.map(indexBy),
    map: () => [...coll.keys()],
    object: () => Object.keys(coll),
  }[typeOf(coll)];

  return fn ? fn(coll) : [];
}

function mapOnMap(fn, map) {
  return new Map([...map.entries()].map(([k, v]) => [k, fn(v)]));
}
