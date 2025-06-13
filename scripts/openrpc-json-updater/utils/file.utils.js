// SPDX-License-Identifier: Apache-2.0

import fs from 'fs';

export function readJson(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return {
      data: JSON.parse(content),
      originalContent: content,
    };
  } catch (err) {
    console.error(`Unable to read or parse "${filePath}":`, err);
    process.exit(1);
  }
}

/**
 * Formats a JSON object with custom indentation and compact array handling
 * @param {*} obj - The object to format
 * @param {string} indent - The indentation string (default: '  ')
 * @param {number} level - The current nesting level (default: 0)
 * @returns {string} Formatted JSON string
 */
function formatJson(obj, indent = '  ', level = 0) {
  const formatter = new JsonFormatter(indent, level);
  return formatter.format(obj);
}

/**
 * JSON formatter class that handles different data types and formatting rules
 */
class JsonFormatter {
  constructor(indent, level) {
    this.indent = indent;
    this.level = level;
    this.currentIndent = indent.repeat(level);
    this.nextIndent = indent.repeat(level + 1);
  }

  /**
   * Main formatting method that delegates to specific type handlers
   * @param {*} obj - The object to format
   * @returns {string} Formatted string representation
   */
  format(obj) {
    if (this.isPrimitive(obj)) {
      return this.formatPrimitive(obj);
    }

    if (Array.isArray(obj)) {
      return this.formatArray(obj);
    }

    return this.formatObject(obj);
  }

  /**
   * Checks if a value is a primitive type
   * @param {*} value - The value to check
   * @returns {boolean} True if the value is primitive
   */
  isPrimitive(value) {
    return (
      value === null ||
      value === undefined ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'string'
    );
  }

  /**
   * Formats primitive values (null, undefined, numbers, booleans, strings)
   * @param {*} value - The primitive value to format
   * @returns {string} Formatted primitive value
   */
  formatPrimitive(value) {
    if (value === null || value === undefined) {
      return 'null';
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    if (typeof value === 'string') {
      return JSON.stringify(value);
    }

    return String(value);
  }

  /**
   * Formats arrays with compact or expanded layout based on content
   * @param {Array} array - The array to format
   * @returns {string} Formatted array string
   */
  formatArray(array) {
    if (array.length === 0) {
      return '[]';
    }

    if (this.shouldUseCompactArrayFormat(array)) {
      return this.formatCompactArray(array);
    }

    return this.formatExpandedArray(array);
  }

  /**
   * Determines if an array should use compact formatting
   * @param {Array} array - The array to check
   * @returns {boolean} True if compact formatting should be used
   */
  shouldUseCompactArrayFormat(array) {
    const maxCompactLength = 8;
    const maxStringLength = 40;

    return array.length <= maxCompactLength && array.every((item) => this.isCompactableItem(item, maxStringLength));
  }

  /**
   * Checks if an array item is suitable for compact formatting
   * @param {*} item - The item to check
   * @param {number} maxStringLength - Maximum string length for compact format
   * @returns {boolean} True if item can be formatted compactly
   */
  isCompactableItem(item, maxStringLength) {
    return (
      (typeof item === 'string' && item.length < maxStringLength) ||
      typeof item === 'number' ||
      typeof item === 'boolean'
    );
  }

  /**
   * Formats an array in compact single-line format
   * @param {Array} array - The array to format
   * @returns {string} Compact formatted array
   */
  formatCompactArray(array) {
    const items = array.map((item) => this.createChildFormatter().format(item)).join(', ');
    return `[${items}]`;
  }

  /**
   * Formats an array in expanded multi-line format
   * @param {Array} array - The array to format
   * @returns {string} Expanded formatted array
   */
  formatExpandedArray(array) {
    const childFormatter = this.createChildFormatter();
    const items = array.map((item) => this.nextIndent + childFormatter.format(item)).join(',\n');

    return `[\n${items}\n${this.currentIndent}]`;
  }

  /**
   * Formats objects with proper indentation and key-value pairs
   * @param {Object} obj - The object to format
   * @returns {string} Formatted object string
   */
  formatObject(obj) {
    const entries = Object.entries(obj);

    if (entries.length === 0) {
      return '{}';
    }

    const childFormatter = this.createChildFormatter();
    const props = entries.map(([key, value]) => this.formatObjectProperty(key, value, childFormatter)).join(',\n');

    return `{\n${props}\n${this.currentIndent}}`;
  }

  /**
   * Formats a single object property (key-value pair)
   * @param {string} key - The property key
   * @param {*} value - The property value
   * @param {JsonFormatter} childFormatter - Formatter for the child value
   * @returns {string} Formatted property string
   */
  formatObjectProperty(key, value, childFormatter) {
    const formattedValue = childFormatter.format(value);
    return `${this.nextIndent}"${key}": ${formattedValue}`;
  }

  /**
   * Creates a child formatter for the next nesting level
   * @returns {JsonFormatter} A new formatter for child elements
   */
  createChildFormatter() {
    return new JsonFormatter(this.indent, this.level + 1);
  }
}

export function writeJson(filePath, data, originalContent) {
  try {
    if (!originalContent) {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      return true;
    }

    const eol = originalContent.includes('\r\n') ? '\r\n' : '\n';
    const formatted = formatJson(data);
    const output = formatted.replace(/\n/g, eol);
    fs.writeFileSync(filePath, output, 'utf-8');
    return true;
  } catch (err) {
    console.error(`Unable to write to "${filePath}":`, err);
  }
}
