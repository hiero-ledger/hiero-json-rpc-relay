// SPDX-License-Identifier: Apache-2.0

import { shouldSkipKey, shouldSkipMethod, shouldSkipPath } from '../config.js';
import {
  filterSkippedMethods,
  findRefPaths,
  getNestedValue,
  getObjectByPath,
  handleRefField,
  handleRefFieldsWithOriginal,
  removeSkippedKeys,
  setNestedValue,
  setObjectByPath,
} from '../utils/merge.utils.js';
import { getDifferingKeys, getMethodMap } from '../utils/openrpc.utils.js';

class MergeDocuments {
  /**
   * Merges two OpenRPC documents
   * @param {Object} originalJson - The original OpenRPC document
   * @param {Object} modifiedJson - The modified Hedera OpenRPC document
   * @returns {Object} - The merged OpenRPC document
   */
  mergeDocuments(originalJson, modifiedJson) {
    if (!Array.isArray(originalJson.methods)) return modifiedJson;
    if (!Array.isArray(modifiedJson.methods)) modifiedJson.methods = [];

    // Step 1: Filter methods that should be skipped
    const filteredOriginal = this.filterDocument(originalJson);
    const filteredModified = this.filterDocument(modifiedJson);

    // Step 2: Merge methods from original to hedera's modified file
    this.mergeMethods(filteredOriginal, filteredModified);

    // Step 3: Merge components from original to hedera's modified file
    this.mergeComponents(filteredOriginal, filteredModified);

    // Step 4: Process the final document
    return this.processDocument(filteredModified, filteredOriginal);
  }

  /**
   * Filters a document to remove methods that should be skipped
   * @param {Object} document - The document to filter
   * @returns {Object} - The filtered document
   */
  filterDocument(document) {
    const filtered = JSON.parse(JSON.stringify(document));
    filtered.methods = filterSkippedMethods(filtered.methods);
    return filtered;
  }

  /**
   * Merges methods from original to modified
   * @param {Object} filteredOriginal - The filtered original document
   * @param {Object} filteredModified - The filtered modified document
   */
  mergeMethods(filteredOriginal, filteredModified) {
    const modifiedMap = getMethodMap(filteredModified);

    for (const origMethod of filteredOriginal.methods) {
      const name = origMethod.name;
      if (!name) continue;

      if (!modifiedMap.has(name)) {
        filteredModified.methods.push(origMethod);
        continue;
      }
      const modMethod = modifiedMap.get(name);

      this.processRefFields(origMethod, modMethod);
      this.processDifferingKeys(origMethod, modMethod);
    }
  }

  /**
   * Processes $ref fields in a method
   * @param {Object} origMethod - The original method
   * @param {Object} modMethod - The modified method
   */
  processRefFields(origMethod, modMethod) {
    const refPaths = findRefPaths(origMethod);

    for (const { path } of refPaths) {
      this.replaceObjectAtPath(origMethod, modMethod, path);
    }
  }

  /**
   * Replaces an object at a specific path with the original object
   * @param {Object} origMethod - The original method
   * @param {Object} modMethod - The modified method
   * @param {string} path - The path to the object to replace
   * @private
   */
  replaceObjectAtPath(origMethod, modMethod, path) {
    const targetObj = this.getObjectAtPath(modMethod, path);
    const origObj = this.getObjectAtPath(origMethod, path);

    if (!this.areValidObjects(targetObj, origObj)) {
      return;
    }

    if (path) {
      setObjectByPath(modMethod, path, this.deepClone(origObj));
    } else {
      this.replaceRootObject(modMethod, origObj);
    }
  }

  /**
   * Gets an object at the specified path or returns the root object if no path
   * @param {Object} obj - The object to navigate
   * @param {string} path - The path to navigate to
   * @returns {*} The object at the path or the root object
   * @private
   */
  getObjectAtPath(obj, path) {
    return path ? getObjectByPath(obj, path) : obj;
  }

  /**
   * Validates that both objects are valid objects
   * @param {*} targetObj - The target object
   * @param {*} origObj - The original object
   * @returns {boolean} True if both are valid objects
   * @private
   */
  areValidObjects(targetObj, origObj) {
    return targetObj && typeof targetObj === 'object' && origObj && typeof origObj === 'object';
  }

  /**
   * Creates a deep clone of an object
   * @param {*} obj - The object to clone
   * @returns {*} A deep clone of the object
   * @private
   */
  deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Replaces the root object by clearing the target and copying from source
   * @param {Object} targetObj - The object to clear and replace
   * @param {Object} sourceObj - The source object to copy from
   * @private
   */
  replaceRootObject(targetObj, sourceObj) {
    Object.keys(targetObj).forEach((key) => {
      delete targetObj[key];
    });

    Object.assign(targetObj, sourceObj);
  }

  /**
   * Processes differing keys between original and modified methods
   * @param {Object} origMethod - The original method
   * @param {Object} modMethod - The modified method
   */
  processDifferingKeys(origMethod, modMethod) {
    const differingKeys = getDifferingKeys(origMethod, modMethod);

    for (const path of differingKeys) {
      if (shouldSkipPath(path)) continue;

      const methodName = origMethod.name;
      if (shouldSkipMethod(methodName, path)) continue;

      const valueFromOriginal = getNestedValue(origMethod, path);

      if (this.shouldSkipDueToRef(modMethod, path)) continue;

      if (path.includes('.')) {
        setNestedValue(modMethod, path, valueFromOriginal);
      } else {
        modMethod[path] = valueFromOriginal;
      }
    }
  }

  /**
   * Checks if a path should be skipped due to containing a $ref
   * @param {Object} obj - The object to check
   * @param {string} path - The path to check
   * @returns {boolean} - Whether the path should be skipped
   */
  shouldSkipDueToRef(obj, path) {
    const parts = path.split('.');
    let checkPath = '';
    for (let i = 0; i < parts.length; i++) {
      checkPath = checkPath ? `${checkPath}.${parts[i]}` : parts[i];
      const value = getNestedValue(obj, checkPath);
      if (value && typeof value === 'object' && value['$ref'] !== undefined) {
        return true;
      }
    }
    return false;
  }

  /**
   * Merges components from original to modified
   * @param {Object} filteredOriginal - The filtered original document
   * @param {Object} filteredModified - The filtered modified document
   */
  mergeComponents(filteredOriginal, filteredModified) {
    if (!this.hasValidComponents(filteredOriginal)) {
      return;
    }

    this.ensureComponentsExist(filteredModified);

    const originalComponents = filteredOriginal.components;
    const modifiedComponents = filteredModified.components;

    Object.keys(originalComponents).forEach((sectionName) => {
      this.mergeSectionComponents(originalComponents[sectionName], modifiedComponents, sectionName);
    });
  }

  /**
   * Validates if the document has valid components
   * @param {Object} document - The document to validate
   * @returns {boolean} True if document has valid components
   * @private
   */
  hasValidComponents(document) {
    return document?.components && typeof document.components === 'object';
  }

  /**
   * Ensures the component object exists in the target document
   * @param {Object} document - The document to ensure components exist in
   * @private
   */
  ensureComponentsExist(document) {
    if (!document.components) {
      document.components = {};
    }
  }

  /**
   * Merges components from a specific section
   * @param {Object} originalSection - The original section components
   * @param {Object} modifiedComponents - The modified document's components object
   * @param {string} sectionName - The name of the section being merged
   * @private
   */
  mergeSectionComponents(originalSection, modifiedComponents, sectionName) {
    if (!originalSection || typeof originalSection !== 'object') {
      return;
    }

    this.ensureSectionExists(modifiedComponents, sectionName);

    const validKeys = this.getValidKeysFromSection(originalSection);

    validKeys.forEach((key) => {
      this.mergeComponentKey(originalSection[key], modifiedComponents[sectionName], key);
    });
  }

  /**
   * Ensures a specific section exists in the components object
   * @param {Object} components - The components object
   * @param {string} sectionName - The section name to ensure exists
   * @private
   */
  ensureSectionExists(components, sectionName) {
    if (!components[sectionName]) {
      components[sectionName] = {};
    }
  }

  /**
   * Gets valid keys from a section (excludes skipped keys)
   * @param {Object} section - The section to get keys from
   * @returns {string[]} Array of valid key names
   * @private
   */
  getValidKeysFromSection(section) {
    return Object.keys(section).filter((key) => !shouldSkipKey(key));
  }

  /**
   * Merges a specific component key if it doesn't already exist
   * @param {*} originalValue - The original component value
   * @param {Object} targetSection - The target section to merge into
   * @param {string} key - The component key name
   * @private
   */
  mergeComponentKey(originalValue, targetSection, key) {
    if (!targetSection[key]) {
      targetSection[key] = removeSkippedKeys(originalValue);
    }
  }

  /**
   * Processes a document to handle $ref fields and remove skipped keys
   * @param {Object} document - The document to process
   * @param {Object} originalDocument - The original document
   * @returns {Object} - The processed document
   */
  /**
   * Processes a document to handle $ref fields and remove skipped keys
   * @param {Object} document - The document to process
   * @param {Object} originalDocument - The original document
   * @returns {Object} - The processed document
   */
  processDocument(document, originalDocument) {
    if (!this.isValidDocument(document)) {
      return document;
    }

    const result = this.cloneDocument(document);

    this.filterAndCleanMethods(result);

    if (originalDocument) {
      return this.processWithOriginalDocument(result, originalDocument);
    }

    return handleRefField(result);
  }

  /**
   * Validates if the document has the required structure
   * @param {Object} document - The document to validate
   * @returns {boolean} True if a document is valid
   * @private
   */
  isValidDocument(document) {
    return document && document.methods && Array.isArray(document.methods);
  }

  /**
   * Creates a deep clone of the document
   * @param {Object} document - The document to clone
   * @returns {Object} A deep clone of the document
   * @private
   */
  cloneDocument(document) {
    return JSON.parse(JSON.stringify(document));
  }

  /**
   * Filters out skipped methods and removes skipped keys from remaining methods
   * @param {Object} document - The document to process
   * @private
   */
  filterAndCleanMethods(document) {
    document.methods = filterSkippedMethods(document.methods);
    document.methods = this.removeSkippedKeysFromMethods(document.methods);
  }

  /**
   * Removes skipped keys from all methods
   * @param {Array} methods - Array of methods to clean
   * @returns {Array} Array of methods with skipped keys removed
   * @private
   */
  removeSkippedKeysFromMethods(methods) {
    return methods.map((method) => removeSkippedKeys(method));
  }

  /**
   * Processes the document when an original document is available
   * @param {Object} document - The document to process
   * @param {Object} originalDocument - The original document for reference
   * @returns {Object} The processed document
   * @private
   */
  processWithOriginalDocument(document, originalDocument) {
    this.processMethodsWithOriginal(document, originalDocument);
    this.processComponentsWithOriginal(document, originalDocument);
    return document;
  }

  /**
   * Processes methods with reference to the original document
   * @param {Object} document - The document to process
   * @param {Object} originalDocument - The original document for reference
   * @private
   */
  processMethodsWithOriginal(document, originalDocument) {
    if (!document.methods || !originalDocument.methods) {
      return;
    }

    const origMethodMap = getMethodMap(originalDocument);

    document.methods = document.methods.map((method) => {
      const origMethod = origMethodMap.get(method.name);
      return origMethod ? handleRefFieldsWithOriginal(method, origMethod) : method;
    });
  }

  /**
   * Processes components with reference to the original document
   * @param {Object} document - The document to process
   * @param {Object} originalDocument - The original document for reference
   * @private
   */
  processComponentsWithOriginal(document, originalDocument) {
    if (!document.components || !originalDocument.components) {
      return;
    }

    document.components = handleRefFieldsWithOriginal(document.components, originalDocument.components, true);
  }
}

const mergeDocumentsInstance = new MergeDocuments();

/**
 * Merges two OpenRPC documents
 * @param {Object} originalJson - The original OpenRPC document
 * @param {Object} modifiedJson - The modified OpenRPC document
 * @returns {Object} - The merged OpenRPC document
 */
export function mergeDocuments(originalJson, modifiedJson) {
  return mergeDocumentsInstance.mergeDocuments(originalJson, modifiedJson);
}
