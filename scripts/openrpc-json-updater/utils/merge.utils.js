// SPDX-License-Identifier: Apache-2.0

import { shouldSkipKey, shouldSkipMethod } from '../config.js';

/**
 * Sets a nested value in an object using a dot-notation path
 */
export function setNestedValue(obj, path, value) {
  if (!path) return;

  const parts = path.split('.');
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];

    if (current[part] === undefined || current[part] === null || typeof current[part] !== 'object') {
      current[part] = {};
    }

    current = current[part];
  }

  const lastPart = parts[parts.length - 1];
  current[lastPart] = value;
}

/**
 * Gets a nested value from an object using a dot-notation path
 */
export function getNestedValue(obj, path) {
  if (!path) return undefined;

  const parts = path.split('.');
  let current = obj;

  for (const part of parts) {
    if (current === undefined || current === null || typeof current !== 'object') {
      return undefined;
    }
    current = current[part];
  }

  return current;
}

/**
 * Checks if a nested path exists in an object
 */
export function hasNestedPath(obj, path) {
  const value = getNestedValue(obj, path);
  return value !== undefined;
}

/**
 * Removes keys that should be skipped from an object
 */
export function removeSkippedKeys(obj) {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => removeSkippedKeys(item));
  }

  const result = {};
  for (const key in obj) {
    if (shouldSkipKey(key)) continue;

    result[key] = removeSkippedKeys(obj[key]);
  }

  return result;
}

/**
 * Handles $ref fields in an object
 */
export function handleRefField(obj) {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => handleRefField(item));
  }

  if (obj['$ref'] !== undefined) {
    return { $ref: obj['$ref'] };
  }

  const result = {};
  for (const key in obj) {
    result[key] = handleRefField(obj[key]);
  }

  return result;
}

/**
 * Gets an object by path from an object
 */
export function getObjectByPath(obj, path) {
  const parts = path.split('.');
  let current = obj;

  for (const part of parts) {
    if (current === undefined || current === null || typeof current !== 'object') {
      return undefined;
    }
    current = current[part];
  }

  return current;
}

/**
 * Sets an object by path in an object
 */
export function setObjectByPath(obj, path, value) {
  const parts = path.split('.');
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];

    if (current[part] === undefined || current[part] === null || typeof current[part] !== 'object') {
      current[part] = {};
    }

    current = current[part];
  }

  const lastPart = parts[parts.length - 1];
  current[lastPart] = value;
}

/**
 * Finds all paths in an object that contain $ref fields
 * @param {*} obj - The object to search
 * @param {string} currentPath - The current path (used internally for recursion)
 * @param {Array} paths - The accumulated paths array (used internally for recursion)
 * @returns {Array} Array of objects with path and ref properties
 */
export function findRefPaths(obj, currentPath = '', paths = []) {
  const pathFinder = new RefPathFinder();
  return pathFinder.find(obj, currentPath, paths);
}

/**
 * Class responsible for finding $ref paths in objects
 */
class RefPathFinder {
  /**
   * Main method to find all $ref paths in an object
   * @param {*} obj - The object to search
   * @param {string} currentPath - The current path
   * @param {Array} paths - The accumulated paths array
   * @returns {Array} Array of ref path objects
   */
  find(obj, currentPath = '', paths = []) {
    if (!this.isValidObject(obj)) {
      return paths;
    }

    if (Array.isArray(obj)) {
      this.processArray(obj, currentPath, paths);
    } else {
      this.processObject(obj, currentPath, paths);
    }

    return paths;
  }

  /**
   * Validates if the object is suitable for processing
   * @param {*} obj - The object to validate
   * @returns {boolean} True if object can be processed
   */
  isValidObject(obj) {
    return obj && typeof obj === 'object';
  }

  /**
   * Processes an array and recursively searches its elements
   * @param {Array} array - The array to process
   * @param {string} currentPath - The current path
   * @param {Array} paths - The accumulated paths array
   */
  processArray(array, currentPath, paths) {
    array.forEach((item, index) => {
      const itemPath = this.buildPath(currentPath, index);
      this.find(item, itemPath, paths);
    });
  }

  /**
   * Processes an object and searches for $ref fields and nested objects
   * @param {Object} obj - The object to process
   * @param {string} currentPath - The current path
   * @param {Array} paths - The accumulated paths array
   */
  processObject(obj, currentPath, paths) {
    if (this.hasRefField(obj)) {
      this.addRefPath(currentPath, obj['$ref'], paths);
    }

    this.processObjectProperties(obj, currentPath, paths);
  }

  /**
   * Checks if an object has a $ref field
   * @param {Object} obj - The object to check
   * @returns {boolean} True if object has $ref field
   */
  hasRefField(obj) {
    return obj['$ref'] !== undefined;
  }

  /**
   * Adds a ref path to the paths array
   * @param {string} path - The path to the ref
   * @param {string} ref - The ref value
   * @param {Array} paths - The paths array to add to
   */
  addRefPath(path, ref, paths) {
    paths.push({
      path,
      ref,
    });
  }

  /**
   * Processes all properties of an object recursively
   * @param {Object} obj - The object whose properties to process
   * @param {string} currentPath - The current path
   * @param {Array} paths - The accumulated paths array
   */
  processObjectProperties(obj, currentPath, paths) {
    Object.keys(obj).forEach((key) => {
      const value = obj[key];
      if (this.shouldProcessProperty(value)) {
        const propertyPath = this.buildPath(currentPath, key);
        this.find(value, propertyPath, paths);
      }
    });
  }

  /**
   * Determines if a property value should be processed recursively
   * @param {*} value - The property value
   * @returns {boolean} True if value should be processed
   */
  shouldProcessProperty(value) {
    return typeof value === 'object' && value !== null;
  }

  /**
   * Builds a dot-notation path from current path and new segment
   * @param {string} currentPath - The current path
   * @param {string|number} segment - The new path segment
   * @returns {string} The combined path
   */
  buildPath(currentPath, segment) {
    return currentPath ? `${currentPath}.${segment}` : String(segment);
  }
}

/**
 * Handles $ref fields with an original object
 * @param {*} obj - The object to process
 * @param {*} origObj - The original object for reference
 * @param {boolean} isComponent - Whether processing components
 * @returns {*} The processed object
 */
export function handleRefFieldsWithOriginal(obj, origObj, isComponent = false) {
  const refHandler = new RefFieldHandler(isComponent);
  return refHandler.handle(obj, origObj);
}

/**
 * Class responsible for handling $ref fields with original object references
 */
class RefFieldHandler {
  constructor(isComponent = false) {
    this.isComponent = isComponent;
  }

  /**
   * Main method to handle ref fields
   * @param {*} obj - The object to process
   * @param {*} origObj - The original object for reference
   * @returns {*} The processed object
   */
  handle(obj, origObj) {
    if (!this.isValidObject(obj)) {
      return obj;
    }

    if (!this.isValidObject(origObj)) {
      return this.handleWithoutOriginal(obj);
    }

    if (Array.isArray(obj)) {
      return this.handleArray(obj, origObj);
    }

    return this.handleObject(obj, origObj);
  }

  /**
   * Validates if an object is suitable for processing
   * @param {*} obj - The object to validate
   * @returns {boolean} True if object can be processed
   */
  isValidObject(obj) {
    return obj && typeof obj === 'object';
  }

  /**
   * Handles processing when no valid original object is available
   * @param {*} obj - The object to process
   * @returns {*} The processed object
   */
  handleWithoutOriginal(obj) {
    return this.isComponent ? obj : handleRefField(obj);
  }

  /**
   * Handles array processing with original array reference
   * @param {Array} array - The array to process
   * @param {Array} origArray - The original array for reference
   * @returns {Array} The processed array
   */
  handleArray(array, origArray) {
    return array.map((item, index) => {
      const origItem = this.getArrayItemSafely(origArray, index);
      return this.handle(item, origItem);
    });
  }

  /**
   * Safely gets an item from an array at the specified index
   * @param {Array} array - The array to get item from
   * @param {number} index - The index to get
   * @returns {*} The item at index or undefined
   */
  getArrayItemSafely(array, index) {
    return Array.isArray(array) && index < array.length ? array[index] : undefined;
  }

  /**
   * Handles object processing with original object reference
   * @param {Object} obj - The object to process
   * @param {Object} origObj - The original object for reference
   * @returns {Object} The processed object
   */
  handleObject(obj, origObj) {
    if (this.hasRefField(origObj)) {
      return this.cloneObject(origObj);
    }

    if (this.hasRefField(obj)) {
      return this.handleObjectWithRef(obj);
    }

    return this.processObjectProperties(obj, origObj);
  }

  /**
   * Checks if an object has a $ref field
   * @param {Object} obj - The object to check
   * @returns {boolean} True if object has $ref field
   */
  hasRefField(obj) {
    return obj && obj['$ref'] !== undefined;
  }

  /**
   * Creates a deep clone of an object
   * @param {Object} obj - The object to clone
   * @returns {Object} A deep clone of the object
   */
  cloneObject(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Handles an object that contains a $ref field
   * @param {Object} obj - The object with $ref field
   * @returns {Object} The processed ref object
   */
  handleObjectWithRef(obj) {
    if (this.isComponent) {
      return this.cloneObject(obj);
    }
    return this.createRefOnlyObject(obj['$ref']);
  }

  /**
   * Creates an object containing only the $ref field
   * @param {string} refValue - The $ref value
   * @returns {Object} Object with only $ref field
   */
  createRefOnlyObject(refValue) {
    return { $ref: refValue };
  }

  /**
   * Processes all properties of an object recursively
   * @param {Object} obj - The object to process
   * @param {Object} origObj - The original object for reference
   * @returns {Object} The processed object with all properties handled
   */
  processObjectProperties(obj, origObj) {
    const newObj = {};

    Object.keys(obj).forEach((key) => {
      const value = obj[key];
      const origValue = origObj[key];
      newObj[key] = this.handle(value, origValue);
    });

    return newObj;
  }
}

/**
 * Filters methods that should be skipped
 */
export function filterSkippedMethods(methods) {
  if (!Array.isArray(methods)) return [];
  return methods.filter((method) => {
    const methodName = method?.name;
    if (!methodName) return true;
    return !shouldSkipMethod(methodName);
  });
}
