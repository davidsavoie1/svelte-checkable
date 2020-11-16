import flexDerived from "./flexDerived";

const identity = (x) => x;

const typeOf = (obj) =>
  ({}.toString.call(obj).split(" ")[1].slice(0, -1).toLowerCase());

function entries(coll) {
  const fn = {
    array: () => coll.map((v, i) => [i, v]),
    map: () => [...coll.entries()],
    object: () => Object.entries(coll),
  }[typeOf(coll)];

  return fn ? fn(coll) : [];
}

function fromEntries(entries, toType) {
  const fn = {
    array: () => entries.map(([, val]) => val),
    map: () => new Map(entries),
    object: () => Object.fromEntries(entries),
  }[toType];
  return fn ? fn() : fromEntries(entries, "map");
}

function deriveState(coll) {
  const storesEntries = entries(coll);
  return {
    coll,
    collType: typeOf(coll),
    storesEntries,
    keys: storesEntries.map(([key]) => key),
    stores: storesEntries.map(([, store]) => store),
  };
}

function collDerived(initialColl, fn = identity, initialValue) {
  let state = deriveState(initialColl);

  /* The callback passed to `flexDerived` can have arity 1 or 2.
   * The arity should match the one of the provided function.
   * When using arity 2, a set function is provided so that
   * result can be used asynchronously */
  const auto = fn.length < 2;
  const index$stores = ($stores) =>
    fromEntries(
      $stores.map((store, idx) => [state.keys[idx], store]),
      state.collType
    );

  const values = flexDerived(
    state.stores,
    auto
      ? ($stores) => fn(index$stores($stores))
      : ($stores, _set) => fn(index$stores($stores), _set),
    initialValue
  );

  function set(newColl) {
    state = deriveState(newColl);
    values.set(state.stores);
  }

  return {
    set,
    subscribe: values.subscribe,
  };
}

export default collDerived;
