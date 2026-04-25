// AEP 2.5 -- Regulatory Disclosure Scanner
// Checks that agent-generated content includes required regulatory disclosures.

import type { Finding, ScannerConfig, RegulatoryScannerConfig, CustomDisclosureRule } from "./types.js";
import type { Scanner } from "./types.js";

const AD_TRIGGERS: RegExp[] = [
  /\bbuy\s+now\b/gi,
  /\blimited\s+offer\b/gi,
  /\bdiscount\b/gi,
  /\bsale\b/gi,
  /\bfree\s+shipping\b/gi,
  /\border\s+today\b/gi,
  /\bspecial\s+deal\b/gi,
  /\bact\s+now\b/gi,
  /\bexclusive\s+offer\b/gi,
];

const AD_DISCLOSURES = [
  "ad",
  "sponsored",
  "advertisement",
  "paid promotion",
  "#ad",
  "#sponsored",
];

const FINANCIAL_TRIGGERS: RegExp[] = [
  /\binvest\s+in\b/gi,
  /\bbuy\s+stock\b/gi,
  /\bfinancial\s+advice\b/gi,
  /\bportfolio\b/gi,
  /\breturns\s+of\b/gi,
  /\btrading\s+strategy\b/gi,
  /\bstock\s+pick\b/gi,
];

const FINANCIAL_DISCLAIMERS = [
  "not financial advice",
  "consult a financial advisor",
  "past performance",
  "financial disclaimer",
  "investment risk",
];

const MEDICAL_TRIGGERS: RegExp[] = [
  /\bdiagnosis\b/gi,
  /\btreatment\b/gi,
  /\bmedication\b/gi,
  /\bsymptoms\b/gi,
  /\bprescription\b/gi,
  /\bdosage\b/gi,
  /\bside\s+effects?\b/gi,
];

const MEDICAL_DISCLAIMERS = [
  "not medical advice",
  "consult a healthcare professional",
  "consult your doctor",
  "medical disclaimer",
  "seek medical attention",
];

const AFFILIATE_PATTERNS: RegExp[] = [
  /[?&]ref=/gi,
  /[?&]aff=/gi,
  /utm_source=affiliate/gi,
  /[?&]affiliate[_=]/gi,
  /[?&]partner[_=]/gi,
];

const AFFILIATE_DISCLOSURES = [
  "affiliate link",
  "commission",
  "paid partnership",
  "affiliate disclosure",
  "earn a commission",
];

const AGE_RESTRICTED_TRIGGERS: RegExp[] = [
  /\balcohol\b/gi,
  /\bbeer\b/gi,
  /\bwine\b/gi,
  /\bspirits\b/gi,
  /\bliquor\b/gi,
  /\btobacco\b/gi,
  /\bcigarette/gi,
  /\bvaping\b/gi,
  /\bgambling\b/gi,
  /\bcasino\b/gi,
  /\bbetting\b/gi,
  /\bwager\b/gi,
];

const AGE_RESTRICTION_NOTICES = [
  "must be 18",
  "must be 21",
  "age verification",
  "of legal age",
  "adults only",
  "18+",
  "21+",
  "age restricted",
];

export class RegulatoryScanner implements Scanner {
  name = "regulatory";
  private severity: ScannerConfig["severity"];
  private checkAdDisclosure: boolean;
  private checkFinancialDisclaimer: boolean;
  private checkMedicalDisclaimer: boolean;
  private checkAffiliateDisclosure: boolean;
  private checkAgeRestriction: boolean;
  private customDisclosures: CustomDisclosureRule[];

  constructor(config?: Partial<RegulatoryScannerConfig>) {
    this.severity = config?.severity ?? "hard";
    this.checkAdDisclosure = config?.check_ad_disclosure ?? true;
    this.checkFinancialDisclaimer = config?.check_financial_disclaimer ?? true;
    this.checkMedicalDisclaimer = config?.check_medical_disclaimer ?? true;
    this.checkAffiliateDisclosure = config?.check_affiliate_disclosure ?? true;
    this.checkAgeRestriction = config?.check_age_restriction ?? true;
    this.customDisclosures = config?.custom_disclosures ?? [];
  }

  scan(content: string): Finding[] {
    const findings: Finding[] = [];
    const lower = content.toLowerCase();

    // Rule 1: Ad disclosure
    if (this.checkAdDisclosure) {
      const hasAdTrigger = AD_TRIGGERS.some((p) => {
        p.lastIndex = 0;
        return p.test(content);
      });
      if (hasAdTrigger) {
        const hasDisclosure = AD_DISCLOSURES.some((d) =>
          lower.includes(d.toLowerCase())
        );
        if (!hasDisclosure) {
          findings.push({
            scanner: this.name,
            severity: this.severity,
            match: "promotional content without ad disclosure",
            position: 0,
            category: "regulatory:missing_ad_disclosure",
          });
        }
      }
    }

    // Rule 2: Financial disclaimer
    if (this.checkFinancialDisclaimer) {
      const hasFinancialTrigger = FINANCIAL_TRIGGERS.some((p) => {
        p.lastIndex = 0;
        return p.test(content);
      });
      if (hasFinancialTrigger) {
        const hasDisclaimer = FINANCIAL_DISCLAIMERS.some((d) =>
          lower.includes(d.toLowerCase())
        );
        if (!hasDisclaimer) {
          findings.push({
            scanner: this.name,
            severity: this.severity,
            match: "financial content without disclaimer",
            position: 0,
            category: "regulatory:missing_financial_disclaimer",
          });
        }
      }
    }

    // Rule 3: Medical disclaimer
    if (this.checkMedicalDisclaimer) {
      const hasMedicalTrigger = MEDICAL_TRIGGERS.some((p) => {
        p.lastIndex = 0;
        return p.test(content);
      });
      if (hasMedicalTrigger) {
        const hasDisclaimer = MEDICAL_DISCLAIMERS.some((d) =>
          lower.includes(d.toLowerCase())
        );
        if (!hasDisclaimer) {
          findings.push({
            scanner: this.name,
            severity: this.severity,
            match: "medical content without disclaimer",
            position: 0,
            category: "regulatory:missing_medical_disclaimer",
          });
        }
      }
    }

    // Rule 4: Affiliate disclosure
    if (this.checkAffiliateDisclosure) {
      const hasAffiliateLink = AFFILIATE_PATTERNS.some((p) => {
        p.lastIndex = 0;
        return p.test(content);
      });
      if (hasAffiliateLink) {
        const hasDisclosure = AFFILIATE_DISCLOSURES.some((d) =>
          lower.includes(d.toLowerCase())
        );
        if (!hasDisclosure) {
          findings.push({
            scanner: this.name,
            severity: this.severity,
            match: "affiliate link without disclosure",
            position: 0,
            category: "regulatory:missing_affiliate_disclosure",
          });
        }
      }
    }

    // Rule 5: Age restriction
    if (this.checkAgeRestriction) {
      const hasAgeRestricted = AGE_RESTRICTED_TRIGGERS.some((p) => {
        p.lastIndex = 0;
        return p.test(content);
      });
      if (hasAgeRestricted) {
        const hasNotice = AGE_RESTRICTION_NOTICES.some((n) =>
          lower.includes(n.toLowerCase())
        );
        if (!hasNotice) {
          findings.push({
            scanner: this.name,
            severity: this.severity,
            match: "age-restricted content without age verification notice",
            position: 0,
            category: "regulatory:missing_age_restriction",
          });
        }
      }
    }

    // Custom disclosure rules
    for (const rule of this.customDisclosures) {
      const hasTrigger = rule.trigger_patterns.some((p) =>
        lower.includes(p.toLowerCase())
      );
      if (hasTrigger) {
        const hasRequired = rule.required_phrases.some((p) =>
          lower.includes(p.toLowerCase())
        );
        if (!hasRequired) {
          findings.push({
            scanner: this.name,
            severity: rule.severity,
            match: `custom disclosure missing for: ${rule.trigger_patterns.join(", ")}`,
            position: 0,
            category: "regulatory:custom_disclosure",
          });
        }
      }
    }

    return findings;
  }
}
