#!/usr/bin/env node
// @ts-check

/**
 * AEP 2.9 Safety Guard
 *
 * Monitors and blocks dangerous AI agent behaviors:
 * - Disabling sandbox/safety flags
 * - Auto-committing without explicit user approval
 * - Modifying permission/config files
 * - Executing destructive commands after user denial
 * - Injecting rogue skill files
 * - Hallucinating user permissions
 *
 * Run as: node harness/aep-safety-guard.js [--watch] [--pre-commit] [--scan]
 *
 * --watch:      Continuous file watcher (runs alongside the agent session)
 * --pre-commit: Git pre-commit hook mode (blocks commit if violations found)
 * --scan:       One-time scan of the project (the default)
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {'CRITICAL' | 'HIGH'} GuardSeverity
 */

/**
 * @typedef {object} SafetyRule
 * @property {GuardSeverity} severity
 * @property {string} description
 * @property {RegExp[]} [patterns]
 * @property {string[]} [files]
 * @property {RegExp[]} [filePatterns]
 * @property {string} [approvalFile]
 * @property {string} [whitelistFile]
 * @property {string} action
 */

/**
 * @typedef {object} GuardViolation
 * @property {string} rule
 * @property {GuardSeverity} severity
 * @property {string} description
 * @property {string} file
 * @property {number} line
 * @property {string} match
 * @property {string} timestamp
 */

// ===========================================================================
// IMMUTABLE SAFETY RULES - THE AI CANNOT OVERRIDE THESE
// ===========================================================================

const SELF = fileURLToPath(import.meta.url);

/** Hosts a request may reach without a whitelist entry. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export const SAFETY_RULES = /** @type {const} */ ({
    // RULE 1: SANDBOX MUST NEVER BE DISABLED BY THE AGENT
    SANDBOX_INTEGRITY: {
        severity: 'CRITICAL',
        description: 'AI agent attempted to disable sandbox safety controls',
        patterns: [
            /dangerouslyDisableSandbox\s*[:=]\s*true/gi,
            /disableSandbox\s*[:=]\s*true/gi,
            /sandbox\s*[:=]\s*false/gi,
            /sandboxMode\s*[:=]\s*['"]?disabled/gi,
            /bypassSandbox\s*[:=]\s*true/gi,
            /SANDBOX_DISABLED/gi,
            /skipSafetyCheck\s*[:=]\s*true/gi,
            /dangerouslyAllowBrowser\s*[:=]\s*true/gi,
            /unsafeMode\s*[:=]\s*true/gi,
        ],
        action: 'BLOCK_AND_REVERT',
    },

    // RULE 2: AGENT MUST NOT MODIFY SAFETY/PERMISSION FILES
    PROTECTED_FILES: {
        severity: 'CRITICAL',
        description: 'AI agent attempted to modify a protected safety file',
        files: [
            '.claude/settings.json',
            '.claude/permissions.json',
            '.claude/safety.json',
            'CLAUDE.md',                    // The harness itself
            'harness/aep-safety-guard.js',  // This file
            'harness/aep-validate.js',      // The validator
            '.claude/commands/aep-preflight.md',
            '.claude/commands/aep-validate.md',
            '.claude/commands/aep-register.md',
            '.gitignore',                   // Prevent agent from hiding files
            '.git/hooks/pre-commit',        // Prevent agent from removing hooks
            '.claude/aep-evidence.jsonl',   // Evidence ledger is append-only
        ],
        action: 'BLOCK_AND_ALERT',
    },

    // RULE 3: NO AUTO-COMMIT WITHOUT EXPLICIT FLAG FILE
    NO_AUTO_COMMIT: {
        severity: 'CRITICAL',
        description: 'AI agent attempted to auto-commit without user permission',
        patterns: [
            /git\s+commit\s+(?!.*--dry-run)/gi,
            /git\s+push/gi,
            /git\s+merge/gi,
            /git\s+rebase/gi,
            /execSync\s*\(\s*['"`]git\s+commit/gi,
            /child_process.*git\s+commit/gi,
        ],
        // Auto-commit is ONLY allowed if .claude/auto-commit-approved exists.
        // This file must be created MANUALLY by the user, never by the agent.
        approvalFile: '.claude/auto-commit-approved',
        action: 'BLOCK_UNLESS_APPROVED',
    },

    // RULE 4: NO DESTRUCTIVE FILE SYSTEM OPERATIONS
    NO_DESTRUCTIVE_OPS: {
        severity: 'CRITICAL',
        description: 'AI agent attempted a destructive file system operation',
        patterns: [
            /rm\s+-rf\s+[/~]/gi,               // rm -rf on root or home
            /rm\s+-rf\s+\.\//gi,               // rm -rf on current dir
            /rmdir\s+\/(?!tmp)/gi,             // rmdir on non-tmp
            /format\s+[a-zA-Z]:/gi,            // Windows format
            /mkfs\./gi,                        // Linux format
            /dd\s+if=.*of=\/dev/gi,            // dd to device
            /chmod\s+777/gi,                   // World-writable
            /chmod\s+-R\s+777/gi,
            /curl.*\|\s*sh/gi,                 // Pipe to shell
            /curl.*\|\s*bash/gi,
            /wget.*\|\s*sh/gi,
            /eval\s*\(\s*['"`].*curl/gi,       // eval + curl
            /node_modules\s*['"]\s*\)/gi,      // Targeting node_modules in exec
            /\b(?:exec|execSync)\s*\(\s*['"`]rm\s/gi, // a call of exec or execSync that runs rm
        ],
        action: 'BLOCK_AND_ALERT',
    },

    // RULE 5: NO SKILL FILE INJECTION
    NO_SKILL_INJECTION: {
        severity: 'CRITICAL',
        description: 'AI agent attempted to create or modify a skill file that overrides safety',
        patterns: [
            /dangerouslyDisableSandbox/gi,
            /autoCommit\s*[:=]\s*true/gi,
            /skipApproval\s*[:=]\s*true/gi,
            /bypassUser\s*[:=]\s*true/gi,
            /autoApprove\s*[:=]\s*true/gi,
            /userApproved\s*[:=]\s*true/gi,
            /permissionGranted\s*[:=]\s*true/gi,
        ],
        filePatterns: [
            /\.claude\/skills\//,
            /\.claude\/commands\//,
            /\.cursorrules/,
            /\.github\/copilot/,
        ],
        action: 'BLOCK_AND_ALERT',
    },

    // RULE 6: NO PERMISSION HALLUCINATION
    NO_PERMISSION_HALLUCINATION: {
        severity: 'HIGH',
        description: 'AI agent claimed user gave permission that was not recorded',
        patterns: [
            /user\s+(has\s+)?already\s+(given\s+)?approv/gi,
            /user\s+(has\s+)?already\s+(given\s+)?permission/gi,
            /permission\s+(was\s+)?(already\s+)?granted/gi,
            /user\s+said\s+(it('s|s)\s+)?ok/gi,
            /obviously\s+safe/gi,
            /assuming\s+permission/gi,
            /implicit(ly)?\s+approv/gi,
        ],
        action: 'FLAG_AND_WARN',
    },

    // RULE 7: NO NETWORK EXFILTRATION. Each pattern captures the URL, so the
    // host can be checked against loopback and the whitelist.
    NO_EXFILTRATION: {
        severity: 'CRITICAL',
        description: 'AI agent attempted to send project data to an external endpoint',
        patterns: [
            /fetch\s*\(\s*['"`](https?:\/\/[^'"`\s]+)/gi,
            /axios\s*\.\s*post\s*\(\s*['"`](https?:\/\/[^'"`\s]+)/gi,
            /request\s*\(\s*['"`](https?:\/\/[^'"`\s]+)/gi,
            /curl\s+.*--data.*?(https?:\/\/[^'"`\s]+)/gi,
            /wget\s+--post\S*\s+.*?(https?:\/\/[^'"`\s]+)/gi,
        ],
        // Allowed domains can be whitelisted in .claude/allowed-domains.json
        whitelistFile: '.claude/allowed-domains.json',
        action: 'BLOCK_UNLESS_WHITELISTED',
    },

    // RULE 8: NO PRIVILEGE MANIPULATION
    NO_PRIVILEGE_MANIPULATION: {
        severity: 'CRITICAL',
        description: 'AI agent attempted to manipulate its own privileges',
        patterns: [
            /set[_.]?trust\s*\(/gi,
            /override[_.]?trust/gi,
            /promote[_.]?self/gi,
            /escalate[_.]?privilege/gi,
        ],
        action: 'BLOCK_AND_ALERT',
    },

    // RULE 9: NO KILL SWITCH BYPASS
    NO_KILL_SWITCH_BYPASS: {
        severity: 'CRITICAL',
        description: 'AI agent attempted to bypass or disable the operator kill switch',
        patterns: [
            /kill[_.]?switch\s*[:=]\s*false/gi,
            /disable[_.]?kill/gi,
            /bypass[_.]?kill/gi,
            /ignore[_.]?kill/gi,
            /kill[_.]?switch[_.]?override/gi,
        ],
        action: 'BLOCK_AND_ALERT',
    },

    // RULE 10: NO FLEET MANIPULATION
    NO_FLEET_MANIPULATION: {
        severity: 'CRITICAL',
        description: 'AI agent attempted to modify fleet policies or spawn without governance',
        patterns: [
            /fleet[_.]?policy\s*[:=]/gi,
            /modify[_.]?fleet/gi,
            /override[_.]?fleet/gi,
            /bypass[_.]?fleet/gi,
            /fleet[_.]?config\s*[:=]/gi,
            /spawn[_.]?ungoverned/gi,
            /disable[_.]?fleet/gi,
            /agent[_.]?limit\s*[:=]\s*(?:Infinity|9999)/gi,
            /cost[_.]?cap\s*[:=]\s*(?:Infinity|9999)/gi,
            /drift[_.]?cluster\s*[:=]\s*false/gi,
        ],
        action: 'BLOCK_AND_ALERT',
    },
});

/** @typedef {keyof typeof SAFETY_RULES} RuleName */

/** Extensions the directory scan reads. */
export const SCANNED_EXTENSIONS = ['.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs', '.json', '.yaml', '.yml', '.md', '.sh', '.bash', '.zsh', '.toml', '.cfg', '.ini', '.env'];

/** @param {string} line */
function isCommentLine(line) {
    const t = line.trim();
    return t.startsWith('//') || t.startsWith('#') || t.startsWith('*');
}

/**
 * The host of a URL in lower case, or null when the text is not a URL.
 * @param {string} url
 * @returns {string | null}
 */
export function hostOf(url) {
    try {
        return new URL(url).hostname.toLowerCase();
    } catch {
        return null;
    }
}

/**
 * True when the host is a whitelisted domain or a subdomain of one. A domain
 * that only contains the whitelisted text, such as example.com.evil.net for
 * example.com, does not match.
 * @param {string} host
 * @param {string[]} domains
 */
export function hostAllowed(host, domains) {
    if (LOOPBACK_HOSTS.has(host)) return true;
    return domains.some((d) => {
        const domain = d.toLowerCase().replace(/^\.+|\.+$/g, '');
        return domain.length > 0 && (host === domain || host.endsWith(`.${domain}`));
    });
}

/** Path with forward slashes, as the protected file list writes it. */
/** @param {string} p */
function posix(p) {
    return p.split(path.sep).join('/');
}

// ===========================================================================
// Scanner
// ===========================================================================

export class SafetyGuard {
    /** @param {string} [projectDir] */
    constructor(projectDir) {
        this.projectDir = projectDir || '.';
        /** @type {GuardViolation[]} */
        this.violations = [];
        this.scannedFiles = 0;
    }

    /**
     * @param {RuleName} rule
     * @param {string} file
     * @param {number} line
     * @param {string} match
     */
    addViolation(rule, file, line, match) {
        this.violations.push({
            rule,
            severity: SAFETY_RULES[rule].severity,
            description: SAFETY_RULES[rule].description,
            file,
            line,
            match: match.substring(0, 80),
            timestamp: new Date().toISOString(),
        });
    }

    /**
     * The whitelisted domains, or null when the whitelist exists and cannot be read.
     * @returns {string[] | null}
     */
    whitelist() {
        const whitelistPath = path.join(this.projectDir, SAFETY_RULES.NO_EXFILTRATION.whitelistFile);
        if (!fs.existsSync(whitelistPath)) return [];
        try {
            /** @type {unknown} */
            const parsed = JSON.parse(fs.readFileSync(whitelistPath, 'utf8'));
            const domains = parsed !== null && typeof parsed === 'object' ? /** @type {{ domains?: unknown }} */ (parsed).domains : undefined;
            if (!Array.isArray(domains)) return null;
            return domains.filter(/** @returns {d is string} */ (d) => typeof d === 'string');
        } catch {
            return null;
        }
    }

    /**
     * Every match of a rule's patterns as [line number, matched text, first group].
     * @param {readonly RegExp[]} patterns
     * @param {string} content
     * @param {string[]} lines
     * @param {boolean} skipComments
     * @returns {[number, string, string | undefined][]}
     */
    matches(patterns, content, lines, skipComments) {
        /** @type {[number, string, string | undefined][]} */
        const out = [];
        for (const pattern of patterns) {
            const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
            for (const match of content.matchAll(new RegExp(pattern.source, flags))) {
                if (match[0].length === 0) continue;
                const lineNum = content.substring(0, match.index).split('\n').length;
                if (skipComments && isCommentLine(lines[lineNum - 1] ?? '')) continue;
                out.push([lineNum, match[0], match[1]]);
            }
        }
        return out;
    }

    /** @param {string} filepath */
    scanFile(filepath) {
        // The guard holds every pattern it looks for, so it never scans itself.
        if (path.resolve(filepath) === SELF) return;
        let content;
        try {
            content = fs.readFileSync(filepath, 'utf8');
        } catch {
            return; // Cannot read, skip
        }

        const relPath = posix(path.relative(this.projectDir, filepath));
        const lines = content.split('\n');
        this.scannedFiles++;

        for (const [line, text] of this.matches(SAFETY_RULES.SANDBOX_INTEGRITY.patterns, content, lines, false)) {
            this.addViolation('SANDBOX_INTEGRITY', relPath, line, text);
        }

        // PROTECTED_FILES is checked in the watcher and in pre-commit mode.

        const approved = fs.existsSync(path.join(this.projectDir, SAFETY_RULES.NO_AUTO_COMMIT.approvalFile));
        if (!approved) {
            for (const [line, text] of this.matches(SAFETY_RULES.NO_AUTO_COMMIT.patterns, content, lines, true)) {
                this.addViolation('NO_AUTO_COMMIT', relPath, line, text);
            }
        }

        for (const [line, text] of this.matches(SAFETY_RULES.NO_DESTRUCTIVE_OPS.patterns, content, lines, true)) {
            this.addViolation('NO_DESTRUCTIVE_OPS', relPath, line, text);
        }

        const isSkillFile = SAFETY_RULES.NO_SKILL_INJECTION.filePatterns.some(p => p.test(relPath));
        if (isSkillFile) {
            for (const [line, text] of this.matches(SAFETY_RULES.NO_SKILL_INJECTION.patterns, content, lines, false)) {
                this.addViolation('NO_SKILL_INJECTION', relPath, line, text);
            }
        }

        for (const [line, text] of this.matches(SAFETY_RULES.NO_PERMISSION_HALLUCINATION.patterns, content, lines, false)) {
            this.addViolation('NO_PERMISSION_HALLUCINATION', relPath, line, text);
        }

        const exfil = this.matches(SAFETY_RULES.NO_EXFILTRATION.patterns, content, lines, true);
        if (exfil.length > 0) {
            const domains = this.whitelist();
            for (const [line, text, url] of exfil) {
                if (domains === null) {
                    // Fail closed on an unreadable or malformed whitelist.
                    this.addViolation('NO_EXFILTRATION', relPath, line, 'whitelist_unreadable:' + text);
                    continue;
                }
                const host = url ? hostOf(url) : null;
                if (host === null || !hostAllowed(host, domains)) {
                    this.addViolation('NO_EXFILTRATION', relPath, line, text);
                }
            }
        }

        for (const rule of /** @type {const} */ (['NO_PRIVILEGE_MANIPULATION', 'NO_KILL_SWITCH_BYPASS', 'NO_FLEET_MANIPULATION'])) {
            for (const [line, text] of this.matches(SAFETY_RULES[rule].patterns, content, lines, true)) {
                this.addViolation(rule, relPath, line, text);
            }
        }
    }

    /** @param {string} dir */
    scanDirectory(dir) {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next' || entry.name === 'dist') continue;
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                this.scanDirectory(fullPath);
            } else if (entry.isFile() && SCANNED_EXTENSIONS.includes(path.extname(entry.name))) {
                this.scanFile(fullPath);
            }
        }
    }

    /**
     * Mark a protected file that a change touched.
     * @param {string} relPath path relative to the project
     */
    checkProtected(relPath) {
        const p = posix(path.normalize(relPath));
        if (/** @type {readonly string[]} */ (SAFETY_RULES.PROTECTED_FILES.files).includes(p)) {
            this.addViolation('PROTECTED_FILES', p, 0, `Protected file modified: ${p}`);
        }
    }

    /**
     * Scan the files staged for commit (pre-commit hook). A failure to list
     * the staged files is a violation: the guard never reports safe on a
     * change it did not read.
     * @param {() => string} [listStaged] returns the staged paths, one per line
     * @returns {number} the count of staged files
     */
    scanGitDiff(listStaged) {
        let diff;
        try {
            diff = listStaged
                ? listStaged()
                : execFileSync('git', ['diff', '--cached', '--name-only', '-z'], { cwd: this.projectDir, encoding: 'utf8' }).split('\0').join('\n');
        } catch (e) {
            this.violations.push({
                rule: 'PROTECTED_FILES',
                severity: 'CRITICAL',
                description: 'The staged files could not be listed, so the commit is not checked',
                file: '.',
                line: 0,
                match: (e instanceof Error ? e.message : String(e)).substring(0, 80),
                timestamp: new Date().toISOString(),
            });
            return 0;
        }
        const files = diff.split('\n').filter(f => f.length > 0);
        for (const file of files) {
            this.checkProtected(file);
            const fullPath = path.join(this.projectDir, file);
            if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) this.scanFile(fullPath);
        }
        return files.length;
    }

    /**
     * Print the report and return the exit code: 2 for CRITICAL, 1 for HIGH, 0 otherwise.
     * @param {(line: string) => void} [log]
     * @returns {0 | 1 | 2}
     */
    report(log = console.log) {
        log('');
        log('=== AEP SAFETY GUARD ===');
        log(`Scanned: ${this.scannedFiles} files`);
        log('');

        if (this.violations.length === 0) {
            log('SAFE. Zero safety violations detected.');
            return 0;
        }

        const critical = this.violations.filter(v => v.severity === 'CRITICAL');
        const high = this.violations.filter(v => v.severity === 'HIGH');

        log(`VIOLATIONS DETECTED: ${this.violations.length}`);
        log(`  CRITICAL: ${critical.length}`);
        log(`  HIGH: ${high.length}`);
        log('');

        for (const v of this.violations) {
            const icon = v.severity === 'CRITICAL' ? 'XXX' : '!!!';
            log(`  [${icon}] ${v.severity}: ${v.description}`);
            log(`       ${v.file}:${v.line}`);
            log(`       Match: ${v.match}`);
            log('');
        }

        if (critical.length > 0) {
            log('BLOCKED. CRITICAL safety violations must be resolved.');
            log('The AI agent attempted an unsafe operation.');
            log('Do NOT proceed until these are fixed.');

            const logDir = path.join(this.projectDir, '.claude');
            const logPath = path.join(logDir, 'safety-violations.log');
            try {
                fs.mkdirSync(logDir, { recursive: true });
                fs.appendFileSync(logPath, this.violations.map(v => JSON.stringify(v)).join('\n') + '\n');
                log(`\nViolations logged to: ${logPath}`);
            } catch (e) {
                log(`\nViolations could not be logged to ${logPath}: ${e instanceof Error ? e.message : String(e)}`);
            }
        }

        return critical.length > 0 ? 2 : (high.length > 0 ? 1 : 0);
    }
}

// ===========================================================================
// File Watcher Mode
// ===========================================================================

/** @param {string} projectDir */
export function watchMode(projectDir) {
    console.log('AEP Safety Guard - WATCH MODE');
    console.log(`Monitoring: ${projectDir}`);
    console.log('Press Ctrl+C to stop.\n');

    const guard = new SafetyGuard(projectDir);
    guard.scanDirectory(projectDir);
    guard.report();

    fs.watch(projectDir, { recursive: true }, (_eventType, filename) => {
        if (!filename) return;
        const name = posix(filename);
        if (name.includes('node_modules') || name.startsWith('.git/')) return;

        const fullPath = path.join(projectDir, filename);
        const fileGuard = new SafetyGuard(projectDir);
        fileGuard.checkProtected(name);
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) fileGuard.scanFile(fullPath);
        if (fileGuard.violations.length > 0) fileGuard.report();
    });
}

// ===========================================================================
// Main
// ===========================================================================

/**
 * @param {string[]} args
 * @param {string} [projectDir]
 * @returns {number | null} the exit code, or null in watch mode
 */
export function main(args, projectDir = '.') {
    if (args.includes('--watch')) {
        watchMode(projectDir);
        return null;
    }
    const guard = new SafetyGuard(projectDir);
    if (args.includes('--pre-commit')) {
        const fileCount = guard.scanGitDiff();
        console.log(`AEP Safety Guard: scanning ${fileCount} staged files...`);
        return guard.report();
    }
    guard.scanDirectory(path.join(projectDir, 'src'));
    guard.scanDirectory(path.join(projectDir, '.claude'));
    guard.scanDirectory(path.join(projectDir, 'harness'));
    return guard.report();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const code = main(process.argv.slice(2));
    if (code !== null) process.exitCode = code;
}
