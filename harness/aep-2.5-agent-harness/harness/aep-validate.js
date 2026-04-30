#!/usr/bin/env node

/**
 * AEP 2.5 Agent Harness -- Automated Validation Script
 * 
 * Scans the project source files and checks every rendered element
 * against the AEP registry, scene graph and theme.
 * 
 * Usage: node harness/aep-validate.js [--fix] [--src=path] [--config=path]
 * 
 * Exit codes:
 *   0 = no violations
 *   1 = violations found (printed to stdout)
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml') || null;

// dynAEP-TA: Temporal and perception validation module
const temporal = (() => {
    try {
        return require('./aep-temporal-validate');
    } catch (e) {
        return null;
    }
})();

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_SRC = './src';
const DEFAULT_CONFIG = '.';
const FILE_EXTENSIONS = ['.tsx', '.jsx', '.ts', '.js', '.vue', '.svelte', '.html'];

const SEVERITY = { CRITICAL: 'CRITICAL', HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW' };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadJSON(filepath) {
    try {
        return JSON.parse(fs.readFileSync(filepath, 'utf8'));
    } catch (e) {
        return null;
    }
}

function loadYAML(filepath) {
    try {
        const content = fs.readFileSync(filepath, 'utf8');
        // Try js-yaml if available, otherwise simple parse
        if (yaml && yaml.load) return yaml.load(content);
        // Fallback: basic key-value extraction
        return { _raw: content };
    } catch (e) {
        return null;
    }
}

function walkDir(dir, extensions) {
    let results = [];
    if (!fs.existsSync(dir)) return results;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist') continue;
        if (entry.isDirectory()) {
            results = results.concat(walkDir(fullPath, extensions));
        } else if (extensions.some(ext => entry.name.endsWith(ext))) {
            results.push(fullPath);
        }
    }
    return results;
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

class AEPValidator {
    constructor(configDir, srcDir) {
        this.violations = [];
        this.scene = loadJSON(path.join(configDir, 'aep-scene.json'));
        this.registry = loadYAML(path.join(configDir, 'aep-registry.yaml'));
        this.theme = loadYAML(path.join(configDir, 'aep-theme.yaml'));
        this.srcDir = srcDir;
        
        // Extract known xids from scene
        this.sceneXids = new Set();
        if (this.scene && this.scene.elements) {
            for (const el of this.scene.elements) {
                this.sceneXids.add(el.id);
            }
        }
        
        // Extract known xids from registry
        this.registryXids = new Set();
        if (this.registry && typeof this.registry === 'object') {
            for (const key of Object.keys(this.registry)) {
                if (key.startsWith('xid:')) this.registryXids.add(key);
            }
        }
        
        // Extract known skin bindings from theme
        this.skinBindings = new Set();
        if (this.theme && this.theme.component_styles) {
            for (const key of Object.keys(this.theme.component_styles)) {
                this.skinBindings.add(key);
            }
        }
        
        // Extract palette colors
        this.paletteColors = new Set();
        if (this.theme && this.theme.colours) {
            for (const val of Object.values(this.theme.colours)) {
                if (typeof val === 'string') this.paletteColors.add(val.toLowerCase());
            }
        }
        
        // Extract design rules
        this.designRules = this.theme?.design_rules || {};

        // dynAEP-TA: Load temporal authority configuration
        this.temporalConfig = null;
        if (temporal) {
            this.temporalConfig = temporal.loadTemporalConfig(configDir);
        }
    }
    
    addViolation(severity, file, line, rule, message) {
        this.violations.push({ severity, file, line, rule, message });
    }
    
    // -----------------------------------------------------------------------
    // Check 1: data-aep-id attributes match registry and scene
    // -----------------------------------------------------------------------
    checkElementRegistration(file, content, lines) {
        const aepIdRegex = /data-aep-id[={"']+([^"'}]+)/g;
        let match;
        while ((match = aepIdRegex.exec(content)) !== null) {
            const xid = match[1].trim();
            const lineNum = content.substring(0, match.index).split('\n').length;
            
            // Check registry
            if (this.registryXids.size > 0 && !this.registryXids.has(xid)) {
                this.addViolation(SEVERITY.CRITICAL, file, lineNum,
                    'ELEMENT_NOT_REGISTERED',
                    `data-aep-id="${xid}" not found in aep-registry.yaml`);
            }
            
            // Check scene
            if (this.sceneXids.size > 0 && !this.sceneXids.has(xid)) {
                this.addViolation(SEVERITY.HIGH, file, lineNum,
                    'ELEMENT_NOT_IN_SCENE',
                    `data-aep-id="${xid}" not found in aep-scene.json`);
            }
        }
    }
    
    // -----------------------------------------------------------------------
    // Check 2: Hardcoded colors
    // -----------------------------------------------------------------------
    checkHardcodedColors(file, content) {
        // Match hex colors in style attributes and CSS
        const hexRegex = /#[0-9a-fA-F]{6}\b/g;
        let match;
        while ((match = hexRegex.exec(content)) !== null) {
            const hex = match[0].toLowerCase();
            const lineNum = content.substring(0, match.index).split('\n').length;
            const line = content.split('\n')[lineNum - 1] || '';
            
            // Skip comments
            if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
            // Skip imports, variable declarations that ARE the palette
            if (line.includes('palette') || line.includes('PALETTE') || line.includes('colors')) continue;
            // Skip AEP config files themselves
            if (file.includes('aep-theme') || file.includes('aep-registry')) continue;
            
            if (this.paletteColors.size > 0 && !this.paletteColors.has(hex)) {
                this.addViolation(SEVERITY.MEDIUM, file, lineNum,
                    'HARDCODED_COLOR',
                    `Color ${hex} is not in the AEP palette. Use a theme token.`);
            }
        }
    }
    
    // -----------------------------------------------------------------------
    // Check 3: Border radius violations
    // -----------------------------------------------------------------------
    checkBorderRadius(file, content) {
        const radiusRegex = /border[Rr]adius[:\s]+['"]?(\d+)/g;
        let match;
        while ((match = radiusRegex.exec(content)) !== null) {
            const value = parseInt(match[1]);
            const lineNum = content.substring(0, match.index).split('\n').length;
            const line = content.split('\n')[lineNum - 1] || '';
            
            if (value > 0 && value !== 50) {
                // Check if this is an allowed exception
                const isException = line.includes('comm-panel') ||
                                    line.includes('commPanel') ||
                                    line.includes('50%') ||
                                    line.includes('circle');
                
                if (!isException && this.designRules.border_radius) {
                    this.addViolation(SEVERITY.HIGH, file, lineNum,
                        'BORDER_RADIUS_VIOLATION',
                        `border-radius: ${value}px found. AEP design rules: ${this.designRules.border_radius}`);
                }
            }
        }
    }
    
    // -----------------------------------------------------------------------
    // Check 4: Box shadow violations
    // -----------------------------------------------------------------------
    checkBoxShadow(file, content) {
        const shadowRegex = /box[Ss]hadow[:\s]+['"]?[^none]/g;
        let match;
        while ((match = shadowRegex.exec(content)) !== null) {
            const lineNum = content.substring(0, match.index).split('\n').length;
            const line = content.split('\n')[lineNum - 1] || '';
            
            // Skip if it is 'none'
            if (line.includes('none') || line.includes('None')) continue;
            // Skip comments
            if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
            
            if (this.designRules.shadows === 'Never' || this.designRules.shadows?.includes('Never')) {
                this.addViolation(SEVERITY.HIGH, file, lineNum,
                    'BOX_SHADOW_VIOLATION',
                    `box-shadow found. AEP design rules forbid shadows. Use glassmorphism.`);
            }
        }
    }
    
    // -----------------------------------------------------------------------
    // Check 5: Hardcoded font families
    // -----------------------------------------------------------------------
    checkHardcodedFonts(file, content) {
        const fontRegex = /fontFamily[:\s]+['"]([^'"]+)['"]/g;
        let match;
        while ((match = fontRegex.exec(content)) !== null) {
            const font = match[1];
            const lineNum = content.substring(0, match.index).split('\n').length;
            const line = content.split('\n')[lineNum - 1] || '';
            
            // Skip theme/config files
            if (file.includes('aep-theme') || file.includes('typography')) continue;
            // Skip if referencing a variable/token
            if (font.includes('var(') || font.includes('T.')) continue;
            
            this.addViolation(SEVERITY.MEDIUM, file, lineNum,
                'HARDCODED_FONT',
                `Hardcoded fontFamily "${font}". Use a typography token from aep-theme.`);
        }
    }
    
    // -----------------------------------------------------------------------
    // Check 6: Internal terminology in user-facing strings
    // -----------------------------------------------------------------------
    checkInternalTerminology(file, content) {
        // Load banned terms from aep-theme.yaml > banned_terms (if defined)
        // Or use a default empty list. Projects customize this for their own architecture.
        const bannedTerms = this.theme?.banned_terms || [];
        
        for (const term of bannedTerms) {
            const pattern = new RegExp(`['"]([^'"]*\\b${term}\\b[^'"]*)['"]`, 'gi');
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const lineNum = content.substring(0, match.index).split('\n').length;
                const line = content.split('\n')[lineNum - 1] || '';
                
                // Skip if in a data-aep-id attribute
                if (line.includes('data-aep-id')) continue;
                // Skip comments
                if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
                // Skip variable names and config keys
                if (line.includes('const ') || line.includes('let ') || line.includes('type ')) continue;
                
                this.addViolation(SEVERITY.HIGH, file, lineNum,
                    'INTERNAL_TERMINOLOGY',
                    `Banned term "${term}" found in user-facing string: "${match[1].substring(0, 50)}..."`);
            }
        }
    }
    
    // -----------------------------------------------------------------------
    // Check 7: Skin binding references resolve
    // -----------------------------------------------------------------------
    checkSkinBindings(file, content) {
        const bindingRegex = /skin_binding[:\s]+['"]?(\w+)/g;
        let match;
        while ((match = bindingRegex.exec(content)) !== null) {
            const binding = match[1];
            const lineNum = content.substring(0, match.index).split('\n').length;
            
            if (this.skinBindings.size > 0 && !this.skinBindings.has(binding)) {
                this.addViolation(SEVERITY.HIGH, file, lineNum,
                    'SKIN_BINDING_MISSING',
                    `skin_binding "${binding}" not found in aep-theme.yaml component_styles`);
            }
        }
    }
    
    // -----------------------------------------------------------------------
    // Check 8: Em-dashes / en-dashes
    // -----------------------------------------------------------------------
    checkDashes(file, content) {
        const emDash = /\u2014/g;
        const enDash = /\u2013/g;
        
        let match;
        while ((match = emDash.exec(content)) !== null) {
            const lineNum = content.substring(0, match.index).split('\n').length;
            this.addViolation(SEVERITY.LOW, file, lineNum,
                'EM_DASH', 'Em-dash (U+2014) found. Use -- instead.');
        }
        while ((match = enDash.exec(content)) !== null) {
            const lineNum = content.substring(0, match.index).split('\n').length;
            this.addViolation(SEVERITY.LOW, file, lineNum,
                'EN_DASH', 'En-dash (U+2013) found. Use -- instead.');
        }
    }
    
    // -----------------------------------------------------------------------
    // Run all checks
    // -----------------------------------------------------------------------
    validate() {
        const files = walkDir(this.srcDir, FILE_EXTENSIONS);
        
        console.log(`AEP 2.5 Validation`);
        console.log(`  Source: ${this.srcDir}`);
        console.log(`  Files: ${files.length}`);
        console.log(`  Registry entries: ${this.registryXids.size}`);
        console.log(`  Scene elements: ${this.sceneXids.size}`);
        console.log(`  Skin bindings: ${this.skinBindings.size}`);
        console.log(`  Palette colors: ${this.paletteColors.size}`);
        if (temporal && this.temporalConfig) {
            console.log(`  Temporal authority: ${this.temporalConfig.enabled ? 'ENABLED' : 'DISABLED'}`);
            console.log(`  Perception governance: ${this.temporalConfig.perception_governance?.enabled ? 'ENABLED' : 'DISABLED'}`);
            console.log(`  Perception modalities: ${temporal.listModalities().join(', ')}`);
        }
        console.log('');
        
        // Phase 1: Temporal validation (runs BEFORE structural)
        if (temporal && this.temporalConfig && this.temporalConfig.enabled) {
            this.checkTemporalViolations();
        }

        // Phase 2: Perception validation (runs between temporal and structural)
        if (temporal && this.temporalConfig && this.temporalConfig.perception_governance &&
            this.temporalConfig.perception_governance.enabled) {
            this.checkPerceptionViolations();
        }

        // Phase 3: Structural validation
        for (const file of files) {
            const content = fs.readFileSync(file, 'utf8');
            const relPath = path.relative(process.cwd(), file);

            this.checkElementRegistration(relPath, content);
            this.checkHardcodedColors(relPath, content);
            this.checkBorderRadius(relPath, content);
            this.checkBoxShadow(relPath, content);
            this.checkHardcodedFonts(relPath, content);
            this.checkInternalTerminology(relPath, content);
            this.checkSkinBindings(relPath, content);
            this.checkDashes(relPath, content);

            // dynAEP-TA: Check for local clock usage in governed code
            if (temporal && this.temporalConfig && this.temporalConfig.enabled) {
                this.checkLocalClockUsage(relPath, content);
            }
        }
        
        // Also validate cross-references between config files
        this.checkCrossReferences();

        // AEP 2.5: Validate evidence ledger integrity
        this.checkEvidenceLedger();

        // AEP 2.5: Validate trust, ring, covenant and drift constraints
        this.checkTrustViolations();

        // AEP 2.5: Validate recovery and scanner entries
        this.checkRecoveryAndScanners();

        return this.violations;
    }
    
    checkCrossReferences() {
        // Registry xids should exist in scene
        for (const xid of this.registryXids) {
            if (this.sceneXids.size > 0 && !this.sceneXids.has(xid)) {
                this.addViolation(SEVERITY.HIGH, 'aep-registry.yaml', 0,
                    'REGISTRY_NOT_IN_SCENE',
                    `${xid} is in registry but not in scene graph`);
            }
        }
        
        // Scene xids should exist in registry
        for (const xid of this.sceneXids) {
            if (this.registryXids.size > 0 && !this.registryXids.has(xid)) {
                this.addViolation(SEVERITY.HIGH, 'aep-scene.json', 0,
                    'SCENE_NOT_IN_REGISTRY',
                    `${xid} is in scene graph but not in registry`);
            }
        }
    }
    
    // -----------------------------------------------------------------------
    // Check 9: Evidence ledger integrity (AEP 2.5)
    // -----------------------------------------------------------------------
    checkEvidenceLedger() {
        const ledgerPath = path.join(this.srcDir, '..', '.claude', 'aep-evidence.jsonl');
        if (!fs.existsSync(ledgerPath)) return; // Ledger is optional until first write

        try {
            const content = fs.readFileSync(ledgerPath, 'utf8');
            const lines = content.split('\n').filter(l => l.trim().length > 0);

            for (let i = 0; i < lines.length; i++) {
                try {
                    const entry = JSON.parse(lines[i]);
                    // Check for blocked gateway verdicts that were not resolved
                    if (entry.verdict === 'blocked' && entry.action !== 'rollback') {
                        this.addViolation(SEVERITY.CRITICAL, '.claude/aep-evidence.jsonl', i + 1,
                            'GATEWAY_POLICY_FAIL',
                            `AgentGateway blocked action on ${entry.target}: ${entry.reason || 'policy failure'}`);
                    }
                    // Check for incomplete rollbacks
                    if (entry.action === 'rollback' && entry.restored !== true) {
                        this.addViolation(SEVERITY.MEDIUM, '.claude/aep-evidence.jsonl', i + 1,
                            'ROLLBACK_INCOMPLETE',
                            `Rollback recorded for ${entry.target} but restoration not confirmed`);
                    }
                } catch (parseErr) {
                    // Malformed line -- not a violation, skip
                }
            }
        } catch (e) {
            // Cannot read ledger, skip
        }
    }

    // -----------------------------------------------------------------------
    // Check 10: Trust tier and ring violations (AEP 2.5)
    // -----------------------------------------------------------------------
    checkTrustViolations() {
        const ledgerPath = path.join(this.srcDir, '..', '.claude', 'aep-evidence.jsonl');
        if (!fs.existsSync(ledgerPath)) return;

        try {
            const content = fs.readFileSync(ledgerPath, 'utf8');
            const lines = content.split('\n').filter(l => l.trim().length > 0);

            for (let i = 0; i < lines.length; i++) {
                try {
                    const entry = JSON.parse(lines[i]);
                    if (entry.trust_violation) {
                        this.addViolation(SEVERITY.CRITICAL, '.claude/aep-evidence.jsonl', i + 1,
                            'TRUST_VIOLATION',
                            `Agent at trust tier ${entry.trust_tier || 'unknown'} attempted ${entry.action} (requires tier ${entry.required_tier || 'higher'})`);
                    }
                    if (entry.ring_violation) {
                        this.addViolation(SEVERITY.CRITICAL, '.claude/aep-evidence.jsonl', i + 1,
                            'RING_VIOLATION',
                            `Agent in Ring ${entry.current_ring || '?'} attempted operation requiring Ring ${entry.required_ring || '?'}: ${entry.action}`);
                    }
                    if (entry.kill_switch_active) {
                        this.addViolation(SEVERITY.CRITICAL, '.claude/aep-evidence.jsonl', i + 1,
                            'KILL_SWITCH_ACTIVE',
                            'Operator kill switch is engaged -- all mutations blocked');
                    }
                    if (entry.covenant_forbid) {
                        this.addViolation(SEVERITY.HIGH, '.claude/aep-evidence.jsonl', i + 1,
                            'COVENANT_FORBID',
                            `Action matched forbid rule: ${entry.covenant_rule || entry.reason || 'unknown rule'}`);
                    }
                    if (entry.intent_drift) {
                        this.addViolation(SEVERITY.HIGH, '.claude/aep-evidence.jsonl', i + 1,
                            'INTENT_DRIFT',
                            `Agent behaviour deviated from baseline (drift score: ${entry.drift_score || '?'})`);
                    }
                    if (entry.merkle_fail) {
                        this.addViolation(SEVERITY.HIGH, '.claude/aep-evidence.jsonl', i + 1,
                            'MERKLE_INTEGRITY_FAIL',
                            'Ledger Merkle proof verification failed -- possible tampering');
                    }
                } catch (parseErr) {}
            }
        } catch (e) {}
    }

    // -----------------------------------------------------------------------
    // Check 11: Recovery and scanner entries (AEP 2.5)
    // -----------------------------------------------------------------------
    checkRecoveryAndScanners() {
        const ledgerPath = path.join(this.srcDir, '..', '.claude', 'aep-evidence.jsonl');
        if (!fs.existsSync(ledgerPath)) return;

        try {
            const content = fs.readFileSync(ledgerPath, 'utf8');
            const lines = content.split('\n').filter(l => l.trim().length > 0);

            for (let i = 0; i < lines.length; i++) {
                try {
                    const entry = JSON.parse(lines[i]);

                    // Scanner findings with hard severity are blocking
                    if (entry.type === 'scanner:finding' && entry.severity === 'hard') {
                        this.addViolation(SEVERITY.CRITICAL, '.claude/aep-evidence.jsonl', i + 1,
                            'SCANNER_HARD_FINDING',
                            `Scanner "${entry.scanner || 'unknown'}" found hard violation: ${entry.details || entry.rule || 'unknown'}`);
                    }

                    // Recovery exhausted means the agent failed to self-correct
                    if (entry.type === 'recovery:exhausted') {
                        this.addViolation(SEVERITY.HIGH, '.claude/aep-evidence.jsonl', i + 1,
                            'RECOVERY_EXHAUSTED',
                            `Recovery exhausted after ${entry.attempts || '?'} attempts for rule: ${entry.rule || 'unknown'}`);
                    }
                } catch (parseErr) {}
            }
        } catch (e) {}
    }

    // -----------------------------------------------------------------------
    // Check 12: Temporal event violations in evidence ledger (dynAEP-TA)
    // -----------------------------------------------------------------------
    checkTemporalViolations() {
        const ledgerPath = path.join(this.srcDir, '..', '.claude', 'aep-evidence.jsonl');
        if (!fs.existsSync(ledgerPath)) return;

        try {
            const content = fs.readFileSync(ledgerPath, 'utf8');
            const lines = content.split('\n').filter(l => l.trim().length > 0);

            for (let i = 0; i < lines.length; i++) {
                try {
                    const entry = JSON.parse(lines[i]);

                    // Validate temporal_validation entries
                    if (entry.type === 'temporal_validation' && entry.data) {
                        const result = temporal.validateTemporalEvent({
                            bridgeTimeMs: entry.data.bridgeTimeMs,
                            agentTimeMs: entry.data.agentTimeMs,
                            agentId: entry.data.agentId,
                            causalPosition: entry.data.causalPosition,
                        }, this.temporalConfig);

                        for (const v of result.violations) {
                            this.addViolation(
                                v.severity === 'CRITICAL' ? SEVERITY.CRITICAL :
                                    v.severity === 'HIGH' ? SEVERITY.HIGH :
                                        v.severity === 'MEDIUM' ? SEVERITY.MEDIUM : SEVERITY.LOW,
                                '.claude/aep-evidence.jsonl',
                                i + 1,
                                'TEMPORAL_' + v.type.toUpperCase(),
                                v.message
                            );
                        }
                    }

                    // Check for recorded temporal violations
                    if (entry.type === 'temporal_violation') {
                        const severity = entry.severity === 'CRITICAL' ? SEVERITY.CRITICAL :
                            entry.severity === 'HIGH' ? SEVERITY.HIGH : SEVERITY.MEDIUM;
                        this.addViolation(severity, '.claude/aep-evidence.jsonl', i + 1,
                            'TEMPORAL_VIOLATION',
                            entry.message || `Temporal violation: ${entry.violation_type || 'unspecified'}`);
                    }
                } catch (parseErr) {}
            }
        } catch (e) {}
    }

    // -----------------------------------------------------------------------
    // Check 13: Perception annotation violations in evidence ledger (dynAEP-TA-P)
    // -----------------------------------------------------------------------
    checkPerceptionViolations() {
        const ledgerPath = path.join(this.srcDir, '..', '.claude', 'aep-evidence.jsonl');
        if (!fs.existsSync(ledgerPath)) return;

        try {
            const content = fs.readFileSync(ledgerPath, 'utf8');
            const lines = content.split('\n').filter(l => l.trim().length > 0);

            for (let i = 0; i < lines.length; i++) {
                try {
                    const entry = JSON.parse(lines[i]);

                    // Validate perception_governance entries
                    if (entry.type === 'perception_governance' && entry.data) {
                        const annotations = {};
                        // Reconstruct annotations from the original values in the entry
                        if (typeof entry.data.originalSyllableRate === 'number') {
                            annotations.syllable_rate = entry.data.originalSyllableRate;
                        }
                        if (typeof entry.data.originalTurnGapMs === 'number') {
                            annotations.turn_gap_ms = entry.data.originalTurnGapMs;
                        }

                        // If the entry has a generic annotations object, use that
                        if (entry.data.originalAnnotations && typeof entry.data.originalAnnotations === 'object') {
                            Object.assign(annotations, entry.data.originalAnnotations);
                        }

                        const modality = entry.data.modality;
                        if (modality && Object.keys(annotations).length > 0) {
                            const result = temporal.validatePerceptionAnnotation(
                                modality,
                                annotations,
                                this.temporalConfig.perception_governance
                            );

                            for (const v of result.violations) {
                                const severity = v.type === 'hard_violation' ? SEVERITY.CRITICAL :
                                    v.type === 'soft_violation' ? SEVERITY.MEDIUM : SEVERITY.HIGH;
                                this.addViolation(severity, '.claude/aep-evidence.jsonl', i + 1,
                                    'PERCEPTION_' + v.type.toUpperCase(),
                                    v.message
                                );
                            }
                        }
                    }

                    // Check for recorded perception violations
                    if (entry.type === 'perception_violation') {
                        const severity = entry.severity === 'hard' ? SEVERITY.CRITICAL : SEVERITY.MEDIUM;
                        this.addViolation(severity, '.claude/aep-evidence.jsonl', i + 1,
                            'PERCEPTION_VIOLATION',
                            entry.message || `Perception violation on ${entry.modality || 'unknown'}: ${entry.parameter || 'unspecified'}`);
                    }
                } catch (parseErr) {}
            }
        } catch (e) {}
    }

    // -----------------------------------------------------------------------
    // Check 14: Local clock usage in governed code paths (dynAEP-TA)
    // -----------------------------------------------------------------------
    checkLocalClockUsage(file, content) {
        // Skip config files, test files and the temporal module itself
        if (file.includes('aep-temporal-validate') ||
            file.includes('aep-safety-guard') ||
            file.includes('.test.') ||
            file.includes('.spec.') ||
            file.includes('node_modules')) return;

        const patterns = [
            { regex: /Date\.now\(\)/g, name: 'Date.now()' },
            { regex: /new\s+Date\(\s*\)/g, name: 'new Date()' },
            { regex: /performance\.now\(\)/g, name: 'performance.now()' },
        ];

        const lines = content.split('\n');

        for (const pat of patterns) {
            pat.regex.lastIndex = 0;
            let match;
            while ((match = pat.regex.exec(content)) !== null) {
                const lineNum = content.substring(0, match.index).split('\n').length;
                const line = lines[lineNum - 1] || '';

                // Skip comments
                if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
                // Skip lines that explicitly reference temporal fallback
                if (line.includes('temporal:fallback') || line.includes('fallback')) continue;

                this.addViolation(SEVERITY.MEDIUM, file, lineNum,
                    'LOCAL_CLOCK_USAGE',
                    `${pat.name} found in governed code. Use dynaep_temporal_query(authoritative_time) instead.`);
            }
        }
    }

    // -----------------------------------------------------------------------
    // Report
    // -----------------------------------------------------------------------
    report() {
        if (this.violations.length === 0) {
            console.log('AEP VALIDATION PASSED. Zero violations.');
            return 0;
        }
        
        const grouped = {};
        for (const v of this.violations) {
            if (!grouped[v.severity]) grouped[v.severity] = [];
            grouped[v.severity].push(v);
        }
        
        console.log(`AEP VALIDATION: ${this.violations.length} violation(s) found.\n`);
        
        for (const severity of [SEVERITY.CRITICAL, SEVERITY.HIGH, SEVERITY.MEDIUM, SEVERITY.LOW]) {
            const items = grouped[severity] || [];
            if (items.length === 0) continue;
            
            console.log(`  ${severity} (${items.length}):`);
            for (const v of items) {
                console.log(`    ${v.file}:${v.line}  [${v.rule}] ${v.message}`);
            }
            console.log('');
        }
        
        const critical = (grouped[SEVERITY.CRITICAL] || []).length;
        const high = (grouped[SEVERITY.HIGH] || []).length;
        
        if (critical > 0 || high > 0) {
            console.log(`BLOCKING: ${critical} CRITICAL + ${high} HIGH violations must be fixed.`);
            return 1;
        }
        
        console.log('NON-BLOCKING: Only MEDIUM/LOW violations. Commit allowed but fix soon.');
        return 0;
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const srcArg = args.find(a => a.startsWith('--src='));
const configArg = args.find(a => a.startsWith('--config='));

const srcDir = srcArg ? srcArg.split('=')[1] : DEFAULT_SRC;
const configDir = configArg ? configArg.split('=')[1] : DEFAULT_CONFIG;

const validator = new AEPValidator(configDir, srcDir);
validator.validate();
const exitCode = validator.report();
process.exit(exitCode);
