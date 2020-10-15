import * as s from "specma";
import { VALID, PENDING } from "./constants";

const {
  fromEntries,
  getCollItem,
  getDeclaredEntries,
  getKeys,
  isColl,
  mergePaths,
} = s.helpers;

/* Return a string describing the type of the argument.
 * More precise than the native typeof operator.
 * https://stackoverflow.com/a/28475765
 * typeOf(); //undefined
 * typeOf(null); //null
 * typeOf(NaN); //number
 * typeOf(5); //number
 * typeOf({}); //object
 * typeOf([]); //array
 * typeOf(''); //string
 * typeOf(function () {}); //function
 * typeOf(/a/) //regexp
 * typeOf(new Date()) //date
 * typeOf(new Error) //error
 * typeOf(Promise.resolve()) //promise
 * typeOf(function *() {}) //generatorfunction
 * typeOf(new WeakMap()) //weakmap
 * typeOf(new Map()) //map */
export const typeOf = (obj) =>
  ({}.toString.call(obj).split(" ")[1].slice(0, -1).toLowerCase());

export const checkCollType = (type) => (x) => {
  if (isColl(x) && typeOf(x) !== type) {
    return `must be of type '${type}'`;
  }
  return true;
};

export function cleanResult(result, key) {
  if (result.valid === true) return VALID;
  if (result.valid === null) return PENDING;

  const { promise, path, ...rest } = result;
  return { ...rest, path: mergePaths(key, path) };
}

export function composeValueAndPred(val, spec) {
  const declaredKeys = getDeclaredEntries(spec).map(([k]) => k);
  const allKeys = union(getKeys(val), declaredKeys);
  return fromEntries(
    typeOf(val),
    allKeys.map((key) => [key, getCollItem(key, val)])
  );
}

export const identity = (x) => x;

/* Combine all elements from the first array and all those from the second one
 * that are not already present in the first. */
export function union(arr1, arr2) {
  const notInArr1 = arr2.filter((x) => !arr1.includes(x));
  return [...arr1, ...notInArr1];
}
