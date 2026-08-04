// lib/categories.mjs
// Single source of truth for per-mission autopilot specificity.
// Consumed by normalize-signals.mjs, pr-body.mjs, and SKILL.md orchestration.

export const CATEGORY_REGISTRY = {
  performance: {
    key: 'performance',
    label: 'Performance',
    includeCategories: ['performance'],
    dbImpact: 'performance',
    signals: {
      advisorTypes: ['performance'],
      logServices: ['postgres', 'edge-function'],
      logRx: /slow|duration|timeout|memory|killed|oom|deadlock|lock wait|statement timeout|5\d\d|too many|n\+1|sequential scan/i,
    },
    branchPrefix: 'ultragraph/perf',
    prTitlePrefix: 'perf',
    prMode: 'ready',
  },
  security: {
    key: 'security',
    label: 'Security',
    includeCategories: ['security'],
    dbImpact: 'security',
    signals: {
      advisorTypes: ['security'],
      logServices: ['postgres', 'edge-function', 'auth'],
      logRx: /permission denied|not authorized|unauthorized|\brls\b|row-level|forbidden|invalid (jwt|token)|\b401\b|\b403\b|secret|leaked/i,
    },
    branchPrefix: 'ultragraph/security',
    prTitlePrefix: 'security',
    prMode: 'ready',
  },
  correctness: {
    key: 'correctness',
    label: 'Correctness & error handling',
    includeCategories: ['correctness', 'error_handling'],
    dbImpact: null,
    signals: {
      advisorTypes: [],
      logServices: ['postgres', 'edge-function'],
      logRx: /error|exception|unhandled|panic|fatal|stack trace|traceback|5\d\d/i,
    },
    branchPrefix: 'ultragraph/correctness',
    prTitlePrefix: 'fix',
    prMode: 'ready',
  },
  cleanup: {
    key: 'cleanup',
    label: 'Cleanup (dead code & duplication)',
    includeCategories: ['dead_code', 'duplication', 'unifiable'],
    dbImpact: null,
    signals: null,
    branchPrefix: 'ultragraph/cleanup',
    prTitlePrefix: 'refactor',
    prMode: 'ready',
  },
  'code-health': {
    key: 'code-health',
    label: 'Code health',
    includeCategories: ['type_safety', 'convention', 'maintainability'],
    dbImpact: null,
    signals: null,
    branchPrefix: 'ultragraph/health',
    prTitlePrefix: 'chore',
    prMode: 'ready',
  },
}

export function resolveCategory(key) {
  return CATEGORY_REGISTRY[key] || CATEGORY_REGISTRY.performance
}
