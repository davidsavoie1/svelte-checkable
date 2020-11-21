import { tick } from "svelte";
import { writable } from "svelte/store";
import { getPred, getSpread } from "specma";
import { VALID } from "./constants";
import collDerived from "./collDerived";
import {
  combineActives,
  get,
  getSpec,
  getSubRequired,
  keys,
  mapOnMap,
  mergePaths,
  resultsRace,
} from "./helpers";
import predCheckable from "./predCheckable";

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
