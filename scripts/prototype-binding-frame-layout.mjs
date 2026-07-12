#!/usr/bin/env node

import { performance } from 'node:perf_hooks';

const SLOT_KIND_VARIABLE = 1;
const MISS = -1;
const NO_START_LIMIT = 0x7fffffff;

const DEFAULTS = {
  frames: 6,
  keys: 192,
  declarationsPerFrame: 768,
  reads: 1_000_000,
  writes: 100_000,
  warmup: 3,
  repeat: 7
};

const args = parseArgs(process.argv.slice(2));
const config = {
  frames: readIntArg(args, '--frames', DEFAULTS.frames),
  keys: readIntArg(args, '--keys', DEFAULTS.keys),
  declarationsPerFrame: readIntArg(args, '--declarations', DEFAULTS.declarationsPerFrame),
  reads: readIntArg(args, '--reads', DEFAULTS.reads),
  writes: readIntArg(args, '--writes', DEFAULTS.writes),
  warmup: readIntArg(args, '--warmup', DEFAULTS.warmup),
  repeat: readIntArg(args, '--repeat', DEFAULTS.repeat)
};

const KEY_NAMES = new Array(config.keys);
for (let i = 0; i < KEY_NAMES.length; i++) {
  KEY_NAMES[i] = `k${i}`;
}

const READ_KEYS = new Array(config.reads);
const READ_KEY_IDS = new Int32Array(config.reads);
const READ_STARTS = new Int32Array(config.reads);
for (let i = 0; i < config.reads; i++) {
  const keyId = (i * 17 + (i >>> 3)) % KEY_NAMES.length;
  READ_KEY_IDS[i] = keyId;
  READ_KEYS[i] = KEY_NAMES[keyId];
  READ_STARTS[i] = i & 1 ? NO_START_LIMIT : (config.declarationsPerFrame - (i % 31));
}

const WRITE_KEYS = new Array(config.writes);
const WRITE_KEY_IDS = new Int32Array(config.writes);
for (let i = 0; i < config.writes; i++) {
  const keyId = (i * 13 + 7) % KEY_NAMES.length;
  WRITE_KEY_IDS[i] = keyId;
  WRITE_KEYS[i] = KEY_NAMES[keyId];
}

const variants = [
  makeMapSlotVariant(),
  makeNullProtoSlotVariant(),
  makeNumericSlotVariant('numeric-key-from-string', false),
  makeNumericSlotVariant('numeric-key-planned-id', true),
  makeRecordObjectVariant()
];

console.log(`Binding frame layout prototype`);
console.log(`node=${process.version} platform=${process.platform}/${process.arch}`);
console.log(`frames=${config.frames} keys=${config.keys} declarations/frame=${config.declarationsPerFrame} reads=${config.reads} writes=${config.writes}`);

for (const variant of variants) {
  assertVariantSemantics(variant);
}
console.log(`semantic assertions=passed`);

for (const variant of variants) {
  for (let i = 0; i < config.warmup; i++) {
    runVariant(variant);
  }
  const readTimes = [];
  const writeTimes = [];
  let checksum = 0;
  let writeChecksum = 0;
  for (let i = 0; i < config.repeat; i++) {
    const result = runVariant(variant);
    readTimes.push(result.readMs);
    writeTimes.push(result.writeMs);
    checksum ^= result.checksum;
    writeChecksum ^= result.writeChecksum;
  }
  console.log(formatResult(variant.name, readTimes, writeTimes, checksum, writeChecksum));
}

function runVariant(variant) {
  const root = buildFrameChain(variant);
  const leaf = root.leaf;
  const readStart = performance.now();
  let checksum = 0;
  for (let i = 0; i < READ_KEYS.length; i++) {
    const key = variant.plannedNumericKey === true ? READ_KEY_IDS[i] : READ_KEYS[i];
    const value = variant.read(leaf, key, READ_STARTS[i]);
    checksum = ((checksum << 5) - checksum + (value ?? 0)) | 0;
  }
  const readMs = performance.now() - readStart;

  const writeStart = performance.now();
  let writeChecksum = 0;
  for (let i = 0; i < WRITE_KEYS.length; i++) {
    const key = variant.plannedNumericKey === true ? WRITE_KEY_IDS[i] : WRITE_KEYS[i];
    const value = i ^ 0x5a5a;
    variant.writeLive(leaf, key, value);
    const read = variant.read(leaf, key, NO_START_LIMIT);
    writeChecksum = ((writeChecksum << 5) - writeChecksum + (read ?? 0)) | 0;
  }
  const writeMs = performance.now() - writeStart;
  return { readMs, writeMs, checksum, writeChecksum };
}

function assertVariantSemantics(variant) {
  const k1 = variant.plannedNumericKey === true ? keyToId('k1') : 'k1';
  const k2 = variant.plannedNumericKey === true ? keyToId('k2') : 'k2';
  const frame = variant.createFrame(undefined, 0);
  variant.registerStatic(frame, 'k1', 'red', 0);
  variant.registerStatic(frame, 'k1', 'blue', 2);
  assertEqual(variant.readCurrent(frame, k1), 'blue', `${variant.name} current read sees same-frame latest`);
  assertEqual(variant.readOccurrence(frame, k1, 1), 'red', `${variant.name} snapshot read sees source-order prior`);
  assertEqual(variant.readOccurrence(frame, k1, NO_START_LIMIT), 'blue', `${variant.name} occurrence read sees latest before unbounded start`);

  const parent = variant.createFrame(undefined, 10);
  variant.registerStatic(parent, 'k1', 'red', 0);
  variant.registerStatic(parent, 'k2', 'black', 1);
  const child = variant.createFrame(parent, 11);
  variant.writeAssignment(child, k1, 'blue');
  variant.registerStatic(child, 'k2', 'white', 0);
  assertEqual(variant.readCurrent(parent, k1), 'blue', `${variant.name} assignment mutates parent binding`);
  assertEqual(variant.readCurrent(parent, k2), 'black', `${variant.name} child declaration does not mutate parent binding`);
  assertEqual(variant.readCurrent(child, k2), 'white', `${variant.name} child declaration shadows locally`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function buildFrameChain(variant) {
  let parent;
  let first;
  for (let frameIndex = 0; frameIndex < config.frames; frameIndex++) {
    const frame = variant.createFrame(parent, frameIndex);
    if (!first) {
      first = frame;
    }
    for (let i = 0; i < config.declarationsPerFrame; i++) {
      const key = KEY_NAMES[(i + frameIndex * 19) % KEY_NAMES.length];
      variant.registerStatic(frame, key, frameIndex * 1_000_000 + i, i);
    }
    for (let i = 0; i < Math.min(32, KEY_NAMES.length); i++) {
      const key = KEY_NAMES[(i * 5 + frameIndex) % KEY_NAMES.length];
      variant.registerLive(frame, key, frameIndex * 10_000 + i, config.declarationsPerFrame + i);
    }
    parent = frame;
  }
  return { root: first, leaf: parent };
}

function makeMapSlotVariant() {
  return {
    name: 'map-slot-arrays',
    createFrame(parent, frameId) {
      return createBaseFrame(parent, frameId, new Map(), new Map());
    },
    registerStatic(frame, key, value, order) {
      const slot = addSlot(frame, SLOT_KIND_VARIABLE, value, order, 0);
      appendMapSlot(frame.variableSlots, key, slot);
      frame.currentVariableSlots.set(key, slot);
    },
    registerLive(frame, key, value, order) {
      const slot = addSlot(frame, SLOT_KIND_VARIABLE, value, order, 1);
      frame.liveVersion[slot] = 0;
      appendMapSlot(frame.variableSlots, key, slot);
      frame.currentVariableSlots.set(key, slot);
    },
    writeLive(frame, key, value) {
      writeAssignmentSlot(frame, key, value, lookupCurrentSlotMap);
    },
    read(frame, key, startOrder) {
      return readFromFrameChain(frame, key, startOrder, lookupLocalSlotMap);
    },
    readCurrent(frame, key) {
      return readCurrentFromFrameChain(frame, key, lookupCurrentSlotMap);
    },
    readOccurrence(frame, key, startOrder) {
      return readFromFrameChain(frame, key, startOrder, lookupLocalSlotMap);
    },
    writeAssignment(frame, key, value) {
      writeAssignmentSlot(frame, key, value, lookupCurrentSlotMap);
    }
  };
}

function makeNullProtoSlotVariant() {
  return {
    name: 'null-proto-slot-arrays',
    createFrame(parent, frameId) {
      return createBaseFrame(parent, frameId, Object.create(null), Object.create(null));
    },
    registerStatic(frame, key, value, order) {
      const slot = addSlot(frame, SLOT_KIND_VARIABLE, value, order, 0);
      appendObjectSlot(frame.variableSlots, key, slot);
      frame.currentVariableSlots[key] = slot;
    },
    registerLive(frame, key, value, order) {
      const slot = addSlot(frame, SLOT_KIND_VARIABLE, value, order, 1);
      frame.liveVersion[slot] = 0;
      appendObjectSlot(frame.variableSlots, key, slot);
      frame.currentVariableSlots[key] = slot;
    },
    writeLive(frame, key, value) {
      writeAssignmentSlot(frame, key, value, lookupCurrentSlotObject);
    },
    read(frame, key, startOrder) {
      return readFromFrameChain(frame, key, startOrder, lookupLocalSlotObject);
    },
    readCurrent(frame, key) {
      return readCurrentFromFrameChain(frame, key, lookupCurrentSlotObject);
    },
    readOccurrence(frame, key, startOrder) {
      return readFromFrameChain(frame, key, startOrder, lookupLocalSlotObject);
    },
    writeAssignment(frame, key, value) {
      writeAssignmentSlot(frame, key, value, lookupCurrentSlotObject);
    }
  };
}

function makeNumericSlotVariant(name, plannedNumericKey) {
  return {
    name,
    plannedNumericKey,
    createFrame(parent, frameId) {
      const frame = createBaseFrame(parent, frameId, new Array(config.keys), new Array(config.keys));
      return frame;
    },
    registerStatic(frame, key, value, order) {
      const slot = addSlot(frame, SLOT_KIND_VARIABLE, value, order, 0);
      const keyId = keyToId(key);
      appendArraySlot(frame.variableSlots, keyId, slot);
      frame.currentVariableSlots[keyId] = slot;
    },
    registerLive(frame, key, value, order) {
      const slot = addSlot(frame, SLOT_KIND_VARIABLE, value, order, 1);
      frame.liveVersion[slot] = 0;
      const keyId = keyToId(key);
      appendArraySlot(frame.variableSlots, keyId, slot);
      frame.currentVariableSlots[keyId] = slot;
    },
    writeLive(frame, key, value) {
      writeAssignmentSlot(frame, key, value, plannedNumericKey ? lookupCurrentSlotArrayById : lookupCurrentSlotArray);
    },
    read(frame, key, startOrder) {
      return readFromFrameChain(frame, key, startOrder, plannedNumericKey ? lookupLocalSlotArrayById : lookupLocalSlotArray);
    },
    readCurrent(frame, key) {
      return readCurrentFromFrameChain(frame, key, plannedNumericKey ? lookupCurrentSlotArrayById : lookupCurrentSlotArray);
    },
    readOccurrence(frame, key, startOrder) {
      return readFromFrameChain(frame, key, startOrder, plannedNumericKey ? lookupLocalSlotArrayById : lookupLocalSlotArray);
    },
    writeAssignment(frame, key, value) {
      writeAssignmentSlot(frame, key, value, plannedNumericKey ? lookupCurrentSlotArrayById : lookupCurrentSlotArray);
    }
  };
}

function makeRecordObjectVariant() {
  return {
    name: 'record-objects-map',
    createFrame(parent, frameId) {
      return {
        parent,
        frameId,
        lookupVersion: 0,
        variableRecords: new Map(),
        currentVariableRecords: new Map()
      };
    },
    registerStatic(frame, key, value, order) {
      const record = {
        kind: SLOT_KIND_VARIABLE,
        value,
        order,
        live: false,
        version: 0
      };
      appendRecord(frame, key, record);
      frame.currentVariableRecords.set(key, record);
    },
    registerLive(frame, key, value, order) {
      const record = {
        kind: SLOT_KIND_VARIABLE,
        value,
        order,
        live: true,
        version: 0
      };
      appendRecord(frame, key, record);
      frame.currentVariableRecords.set(key, record);
    },
    writeLive(frame, key, value) {
      writeAssignmentRecord(frame, key, value);
    },
    read(frame, key, startOrder) {
      let f = frame;
      let start = startOrder;
      while (f) {
        const record = lookupLocalRecord(f, key, start);
        if (record) {
          return record.value;
        }
        start = NO_START_LIMIT;
        f = f.parent;
      }
      return undefined;
    },
    readCurrent(frame, key) {
      let f = frame;
      while (f) {
        const record = f.currentVariableRecords.get(key);
        if (record !== undefined) {
          return record.value;
        }
        f = f.parent;
      }
      return undefined;
    },
    readOccurrence(frame, key, startOrder) {
      return this.read(frame, key, startOrder);
    },
    writeAssignment(frame, key, value) {
      writeAssignmentRecord(frame, key, value);
    }
  };
}

function createBaseFrame(parent, frameId, variableSlots, currentVariableSlots) {
  return {
    parent,
    frameId,
    lookupVersion: 0,
    slotCount: 0,
    variableSlots,
    currentVariableSlots,
    slotKind: [],
    slotFlags: [],
    slotOrder: [],
    slotVersion: [],
    slotValue: [],
    slotSource: [],
    liveVersion: []
  };
}

function addSlot(frame, kind, value, order, flags) {
  const slot = frame.slotCount++;
  frame.slotKind[slot] = kind;
  frame.slotFlags[slot] = flags;
  frame.slotOrder[slot] = order;
  frame.slotVersion[slot] = 0;
  frame.slotValue[slot] = value;
  frame.slotSource[slot] = undefined;
  frame.lookupVersion++;
  return slot;
}

function appendMapSlot(table, key, slot) {
  const existing = table.get(key);
  if (existing === undefined) {
    table.set(key, slot);
  } else if (typeof existing === 'number') {
    table.set(key, [existing, slot]);
  } else {
    existing.push(slot);
  }
}

function appendObjectSlot(table, key, slot) {
  const existing = table[key];
  if (existing === undefined) {
    table[key] = slot;
  } else if (typeof existing === 'number') {
    table[key] = [existing, slot];
  } else {
    existing.push(slot);
  }
}

function appendArraySlot(table, keyId, slot) {
  const existing = table[keyId];
  if (existing === undefined) {
    table[keyId] = slot;
  } else if (typeof existing === 'number') {
    table[keyId] = [existing, slot];
  } else {
    existing.push(slot);
  }
}

function lookupLocalSlotMap(frame, key, startOrder) {
  return pickSlot(frame, frame.variableSlots.get(key), startOrder);
}

function lookupLocalSlotObject(frame, key, startOrder) {
  return pickSlot(frame, frame.variableSlots[key], startOrder);
}

function lookupLocalSlotArray(frame, key, startOrder) {
  return pickSlot(frame, frame.variableSlots[keyToId(key)], startOrder);
}

function lookupLocalSlotArrayById(frame, keyId, startOrder) {
  return pickSlot(frame, frame.variableSlots[keyId], startOrder);
}

function lookupCurrentSlotMap(frame, key) {
  const slot = frame.currentVariableSlots.get(key);
  return slot === undefined ? MISS : slot;
}

function lookupCurrentSlotObject(frame, key) {
  const slot = frame.currentVariableSlots[key];
  return slot === undefined ? MISS : slot;
}

function lookupCurrentSlotArray(frame, key) {
  const slot = frame.currentVariableSlots[keyToId(key)];
  return slot === undefined ? MISS : slot;
}

function lookupCurrentSlotArrayById(frame, keyId) {
  const slot = frame.currentVariableSlots[keyId];
  return slot === undefined ? MISS : slot;
}

function pickSlot(frame, slots, startOrder) {
  if (slots === undefined) {
    return MISS;
  }
  if (typeof slots === 'number') {
    return frame.slotOrder[slots] < startOrder ? slots : MISS;
  }
  for (let i = slots.length - 1; i >= 0; i--) {
    const slot = slots[i];
    if (frame.slotOrder[slot] < startOrder) {
      return slot;
    }
  }
  return MISS;
}

function readFromFrameChain(frame, key, startOrder, lookupLocalSlot) {
  let f = frame;
  let start = startOrder;
  while (f) {
    const slot = lookupLocalSlot(f, key, start);
    if (slot >= 0) {
      return f.slotValue[slot];
    }
    start = NO_START_LIMIT;
    f = f.parent;
  }
  return undefined;
}

function readCurrentFromFrameChain(frame, key, lookupCurrentSlot) {
  let f = frame;
  while (f) {
    const slot = lookupCurrentSlot(f, key);
    if (slot >= 0) {
      return f.slotValue[slot];
    }
    f = f.parent;
  }
  return undefined;
}

function writeAssignmentSlot(frame, key, value, lookupCurrentSlot) {
  let f = frame;
  while (f) {
    const slot = lookupCurrentSlot(f, key);
    if (slot >= 0) {
      f.slotValue[slot] = value;
      f.slotVersion[slot]++;
      if (f.slotFlags[slot] === 1) {
        f.liveVersion[slot]++;
      }
      return true;
    }
    f = f.parent;
  }
  return false;
}

function appendRecord(frame, key, record) {
  const existing = frame.variableRecords.get(key);
  if (existing === undefined) {
    frame.variableRecords.set(key, record);
  } else if (Array.isArray(existing)) {
    existing.push(record);
  } else {
    frame.variableRecords.set(key, [existing, record]);
  }
  frame.lookupVersion++;
}

function lookupLocalRecord(frame, key, startOrder) {
  const records = frame.variableRecords.get(key);
  if (records === undefined) {
    return undefined;
  }
  if (!Array.isArray(records)) {
    return records.order < startOrder ? records : undefined;
  }
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i];
    if (record.order < startOrder) {
      return record;
    }
  }
  return undefined;
}

function writeAssignmentRecord(frame, key, value) {
  let f = frame;
  while (f) {
    const record = f.currentVariableRecords.get(key);
    if (record !== undefined) {
      record.value = value;
      record.version++;
      return true;
    }
    f = f.parent;
  }
  return false;
}

function keyToId(key) {
  return Number(key.slice(1));
}

function formatResult(name, readTimes, writeTimes, checksum, writeChecksum) {
  return [
    name,
    `read median=${median(readTimes).toFixed(2)}ms`,
    `write+read median=${median(writeTimes).toFixed(2)}ms`,
    `read min=${Math.min(...readTimes).toFixed(2)}ms`,
    `write min=${Math.min(...writeTimes).toFixed(2)}ms`,
    `checksum=${checksum}`,
    `writeChecksum=${writeChecksum}`
  ].join('  ');
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function parseArgs(raw) {
  const parsed = new Map();
  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];
    if (arg === '--') {
      continue;
    }
    if (arg.startsWith('--')) {
      parsed.set(arg, raw[i + 1]);
      i++;
    }
  }
  return parsed;
}

function readIntArg(parsed, key, fallback) {
  const raw = parsed.get(key);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${key} must be a positive integer`);
  }
  return value;
}
