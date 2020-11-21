import { and, getMessage, getSpread, isOpt, util } from "specma";
import { VALID } from "./constants";

const { getPath, mergePaths } = util;

export { mergePaths };

export const defaultGetFrom = () => undefined;
const isFunc = (x) => typeof x === "function";

export function alwaysTrue() {
  return true;
}

export function combineActives(actives = []) {
  if (actives.length <= 0) return undefined;
  return actives.reduce((a, b) => (a !== b ? undefined : b));
}

const typeOf = (obj) =>
  ({}.toString.call(obj).split(" ")[1].slice(0, -1).toLowerCase());

function passFailAsync(result) {
  const promise = result.promise || Promise.resolve(result);
  return promise.then((promisedRes) => {
    if (promisedRes.valid === true) return promisedRes;
    throw promisedRes;
  });
}

export function resultsRace(results) {
  return Promise.all(results.map(passFailAsync))
    .then(() => VALID)
    .catch((result) => result);
}

export function get(key, coll) {
  if (typeOf(coll) === "map") return coll.get(key);
  return typeof coll === "object" ? coll[key] : undefined;
}

/* Given a value and a current path, return the sub value
 * at a path relative to current one. */
export function getFromValue(relPath, currPath = [], value) {
  const newPath = relPath.split("/").reduce((acc, move) => {
    if ([null, undefined, "", "."].includes(move)) return acc;

    if (move.startsWith("..")) return acc.slice(0, -1);

    const index = parseInt(move, 10);
    return [...acc, isNaN(index) ? move : index];
  }, currPath);
  return getPath(newPath, value);
}

export function getSubRequired(key, required) {
  const req = isFunc(required) ? required() : required;
  if (typeof req !== "object") return req;
  return get(key, req) || req["..."];
}

export function getSpec({ key, spec, messages, required }) {
  const req = isRequired(required);

  const basicSpec = get(key, spec) || getSpread(spec) || alwaysTrue;
  if (!req) return basicSpec;

  const reqSpec = (x) =>
    ![undefined, null, ""].includes(x) || getMessage("isRequired", messages);
  return and(reqSpec, basicSpec);
}

function isRequired(required) {
  const req = isFunc(required) ? required() : required;
  if (typeof req !== "object") return !!req;
  return req && !isOpt(req);
}

export function keys(coll, indexBy = (v, k) => k) {
  const fn = {
    array: () => coll.map(indexBy),
    map: () => [...coll.keys()],
    object: () => Object.keys(coll),
  }[typeOf(coll)];

  return fn ? fn(coll) : [];
}

export function mapOnMap(fn, map) {
  return new Map([...map.entries()].map(([k, v]) => [k, fn(v)]));
}
