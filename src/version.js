'use strict'

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

function parseVersion(raw) {
  const match = VERSION_RE.exec(String(raw).trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

function compareIdentifier(x, y) {
  const xn = Number(x)
  const yn = Number(y)
  const xIsNum = /^\d+$/.test(x)
  const yIsNum = /^\d+$/.test(y)
  if (xIsNum && yIsNum) return xn < yn ? -1 : xn > yn ? 1 : 0
  if (xIsNum) return -1
  if (yIsNum) return 1
  return x < y ? -1 : x > y ? 1 : 0
}

function compareVersions(a, b) {
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] < b[key]) return -1
    if (a[key] > b[key]) return 1
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  const len = Math.max(a.prerelease.length, b.prerelease.length)
  for (let i = 0; i < len; i++) {
    const x = a.prerelease[i]
    const y = b.prerelease[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const cmp = compareIdentifier(x, y)
    if (cmp !== 0) return cmp
  }
  return 0
}

function isAtLeast(actual, minimum) {
  const a = parseVersion(actual)
  const m = parseVersion(minimum)
  if (a === null || m === null) return false
  return compareVersions(a, m) >= 0
}

module.exports = { parseVersion, compareVersions, isAtLeast }
