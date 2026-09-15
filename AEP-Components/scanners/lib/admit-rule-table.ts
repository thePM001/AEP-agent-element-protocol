// GENERATED FILE. Do not edit by hand.
// Source table: AEP-Components/scanners/rules/scan-rule-table.json
// Generator: AEP-Components/scanners/tools/generate-admit-rule-table.mjs
// This module is the scanners package view of the one scan rule table. The
// Admit policy crate reads the same table, so the rules have one source.

export interface ScanRulePattern {
  pattern: string;
  flags: string;
}

export interface ScanRule {
  id: string;
  class: string;
  category: string;
  ts?: ScanRulePattern;
  admit?: Record<string, unknown>;
}

export const SCAN_RULE_TABLE_ID = "scan-rule-table";
export const SCAN_RULE_TABLE_SOURCE = "AEP-Components/scanners/rules/scan-rule-table.json";

export const SCAN_RULES: ScanRule[] = [
  {"id":"email","class":"pii","category":"pii:email","ts":{"pattern":"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}","flags":"g"},"admit":{"kind":"email"}},
  {"id":"phone","class":"pii","category":"pii:phone","ts":{"pattern":"(?:\\+?1[-.\\s]?)?\\(?\\d{3}\\)?[-.\\s]?\\d{3}[-.\\s]?\\d{4}","flags":"g"},"admit":{"kind":"phone"}},
  {"id":"credit_card","class":"pii","category":"pii:credit_card","ts":{"pattern":"\\b(?:\\d{4}[-\\s]?){3,4}\\d{1,4}\\b","flags":"g"},"admit":{"kind":"luhn"}},
  {"id":"ssn","class":"pii","category":"pii:national_id","ts":{"pattern":"\\b\\d{3}-\\d{2}-\\d{4}\\b","flags":"g"},"admit":{"kind":"ssn"}},
  {"id":"nif","class":"pii","category":"pii:national_id","ts":{"pattern":"\\b[XYZ]?\\d{7,8}[A-Z]\\b","flags":"g"},"admit":null},
  {"id":"nino","class":"pii","category":"pii:national_id","ts":{"pattern":"\\b[A-CEGHJ-PR-TW-Z]{2}\\d{6}[A-D]\\b","flags":"g"},"admit":null},
  {"id":"openai_key","class":"secrets","category":"secrets:api_key","ts":{"pattern":"\\bsk-[a-zA-Z0-9]{20,}","flags":"g"},"admit":{"kind":"prefix_len","prefix":"sk-","min_text_len":21,"ci":false}},
  {"id":"aws_key","class":"secrets","category":"secrets:api_key","ts":{"pattern":"\\bAKIA[A-Z0-9]{16}\\b","flags":"g"},"admit":{"kind":"literal","text":"AKIA","ci":false}},
  {"id":"github_pat","class":"secrets","category":"secrets:api_key","ts":{"pattern":"\\bghp_[a-zA-Z0-9]{36,}\\b","flags":"g"},"admit":{"kind":"literal","text":"ghp_","ci":false}},
  {"id":"github_oauth","class":"secrets","category":"secrets:api_key","ts":{"pattern":"\\bgho_[a-zA-Z0-9]{36,}\\b","flags":"g"},"admit":{"kind":"literal","text":"gho_","ci":false}},
  {"id":"slack_token","class":"secrets","category":"secrets:api_key","ts":{"pattern":"\\bxoxb-[a-zA-Z0-9-]+\\b","flags":"g"},"admit":{"kind":"literal","text":"xoxb-","ci":false}},
  {"id":"slack_user","class":"secrets","category":"secrets:api_key","ts":{"pattern":"\\bxoxp-[a-zA-Z0-9-]+\\b","flags":"g"},"admit":{"kind":"literal","text":"xoxp-","ci":false}},
  {"id":"stripe_key","class":"secrets","category":"secrets:api_key","ts":{"pattern":"\\bsk_live_[a-zA-Z0-9]{24,}\\b","flags":"g"},"admit":{"kind":"literal","text":"sk_live_","ci":false}},
  {"id":"stripe_test","class":"secrets","category":"secrets:api_key","ts":{"pattern":"\\bsk_test_[a-zA-Z0-9]{24,}\\b","flags":"g"},"admit":{"kind":"literal","text":"sk_test_","ci":false}},
  {"id":"rsa_private_key","class":"secrets","category":"secrets:private_key","ts":{"pattern":"-----BEGIN RSA PRIVATE KEY-----","flags":"g"},"admit":{"kind":"literal","text":"BEGIN RSA PRIVATE KEY","ci":false}},
  {"id":"ec_private_key","class":"secrets","category":"secrets:private_key","ts":{"pattern":"-----BEGIN EC PRIVATE KEY-----","flags":"g"},"admit":{"kind":"literal","text":"BEGIN EC PRIVATE KEY","ci":false}},
  {"id":"generic_private_key","class":"secrets","category":"secrets:private_key","ts":{"pattern":"-----BEGIN PRIVATE KEY-----","flags":"g"},"admit":{"kind":"literal","text":"BEGIN PRIVATE KEY","ci":false}},
  {"id":"password_assignment","class":"secrets","category":"secrets:credential","ts":{"pattern":"\\bpassword\\s*=\\s*[\"'][^\"']+[\"']","flags":"gi"},"admit":{"kind":"literal","text":"password=","ci":true}},
  {"id":"secret_assignment","class":"secrets","category":"secrets:credential","ts":{"pattern":"\\bsecret\\s*=\\s*[\"'][^\"']+[\"']","flags":"gi"},"admit":null},
  {"id":"api_key_assignment","class":"secrets","category":"secrets:credential","ts":{"pattern":"\\bapi_key\\s*=\\s*[\"'][^\"']+[\"']","flags":"gi"},"admit":{"kind":"literal","text":"api_key=","ci":true}},
  {"id":"token_assignment","class":"secrets","category":"secrets:credential","ts":{"pattern":"\\btoken\\s*=\\s*[\"'][^\"']+[\"']","flags":"gi"},"admit":{"kind":"literal","text":"token=","ci":true}},
  {"id":"sql_drop","class":"injection","category":"injection:sql","ts":{"pattern":"\\bDROP\\s+TABLE\\b","flags":"gi"},"admit":{"kind":"literal","text":"drop table","ci":true}},
  {"id":"sql_union_select","class":"injection","category":"injection:sql","ts":{"pattern":"\\bUNION\\s+SELECT\\b","flags":"gi"},"admit":{"kind":"literal","text":"union select","ci":true}},
  {"id":"sql_or_tautology","class":"injection","category":"injection:sql","ts":{"pattern":"\\bOR\\s+1\\s*=\\s*1\\b","flags":"gi"},"admit":null},
  {"id":"sql_comment","class":"injection","category":"injection:sql","ts":{"pattern":"'\\s*--","flags":"g"},"admit":null},
  {"id":"sql_semicolon","class":"injection","category":"injection:sql","ts":{"pattern":";\\s*DROP\\b","flags":"gi"},"admit":null},
  {"id":"sql_sleep","class":"injection","category":"injection:sql","ts":{"pattern":"\\bSLEEP\\s*\\(","flags":"gi"},"admit":null},
  {"id":"xss_script","class":"injection","category":"injection:xss","ts":{"pattern":"<script[\\s>]","flags":"gi"},"admit":{"kind":"literal","text":"<script","ci":true}},
  {"id":"xss_onerror","class":"injection","category":"injection:xss","ts":{"pattern":"\\bonerror\\s*=","flags":"gi"},"admit":null},
  {"id":"xss_onload","class":"injection","category":"injection:xss","ts":{"pattern":"\\bonload\\s*=","flags":"gi"},"admit":null},
  {"id":"xss_javascript","class":"injection","category":"injection:xss","ts":{"pattern":"javascript\\s*:","flags":"gi"},"admit":{"kind":"literal","text":"javascript:","ci":true}},
  {"id":"xss_img_src","class":"injection","category":"injection:xss","ts":{"pattern":"<img[^>]+src\\s*=\\s*[\"']?javascript","flags":"gi"},"admit":null},
  {"id":"xss_svg_onload","class":"injection","category":"injection:xss","ts":{"pattern":"<svg[^>]+onload\\s*=","flags":"gi"},"admit":null},
  {"id":"ssti_double_curly","class":"injection","category":"injection:ssti","ts":{"pattern":"\\{\\{.*\\}\\}","flags":"g"},"admit":null},
  {"id":"ssti_block","class":"injection","category":"injection:ssti","ts":{"pattern":"\\{%.*%\\}","flags":"g"},"admit":null},
  {"id":"cmd_semicolon_rm","class":"injection","category":"injection:command","ts":{"pattern":";\\s*rm\\s","flags":"g"},"admit":{"kind":"literal","text":"; rm ","ci":true}},
  {"id":"cmd_pipe_cat","class":"injection","category":"injection:command","ts":{"pattern":"\\|\\s*cat\\s","flags":"g"},"admit":null},
  {"id":"cmd_backtick","class":"injection","category":"injection:command","ts":{"pattern":"`[^`]+`","flags":"g"},"admit":null},
  {"id":"cmd_dollar_paren","class":"injection","category":"injection:command","ts":{"pattern":"\\$\\([^)]+\\)","flags":"g"},"admit":null},
  {"id":"cmd_and_curl","class":"injection","category":"injection:command","ts":{"pattern":"&&\\s*curl\\s","flags":"gi"},"admit":null},
  {"id":"path_traversal","class":"injection","category":"injection:path","admit":{"kind":"literal","text":"../","ci":false}},
  {"id":"xp_cmdshell","class":"injection","category":"injection:command","admit":{"kind":"literal","text":"xp_cmdshell","ci":true}},
  {"id":"mta_client","class":"mail","category":"mail:client","admit":{"kind":"any_literal","texts":["nodemailer","smtplib","sendmail","createtransport","phpmailer","sendrawemail"],"ci":true}},
  {"id":"smtp_url","class":"mail","category":"mail:url","admit":{"kind":"any_literal","texts":["smtp://","smtps://"],"ci":true}},
  {"id":"submission_ports","class":"mail","category":"mail:port","admit":{"kind":"any_literal","texts":[":25",":465",":587","port 25","port 465","port 587"],"ci":true}},
  {"id":"npm_registry","class":"supply-chain","category":"supply-chain:npm","admit":{"kind":"any_literal","texts":["registry.npmjs","npm install","npm publish"],"ci":true}},
  {"id":"public_bind","class":"bindings","category":"bindings:public","admit":{"kind":"any_literal","texts":["0.0.0.0","[::]","::0"],"ci":true}},
  {"id":"forbidden_unicode","class":"unicode","category":"unicode:forbidden","admit":{"kind":"chars","codepoints":[8212,8213,8238,8203]}},
  {"id":"raw_ip","class":"network","category":"network:raw-ip","admit":{"kind":"ipv4"}},
  {"id":"wasm_socket","class":"lattice","category":"lattice:wasm-socket","admit":{"kind":"all_any","all":[":8423"],"any":["listen","bind"],"ci":true}},
  {"id":"staging_in_production","class":"deployment","category":"deployment:staging","admit":{"kind":"all_any","all":["staging","production"],"any":[],"ci":true}},
  {"id":"prohibited_practice","class":"compliance","category":"compliance:prohibited","admit":{"kind":"any_literal","texts":["social_score","real_time_biometric"],"ci":true}},
  {"id":"hipaa_mrn","class":"compliance","category":"compliance:phi","admit":{"kind":"literal","text":"mrn","ci":true}}
];

/** Rows of one class that carry a package pattern. */
export function scanRulesForClass(name: string): ScanRule[] {
  return SCAN_RULES.filter((rule) => rule.class === name && rule.ts !== undefined);
}

/** Compile one row pattern into a fresh RegExp so the caller own lastIndex is used. */
export function compileRulePattern(rule: ScanRule): RegExp | null {
  if (rule.ts === undefined) {
    return null;
  }
  return new RegExp(rule.ts.pattern, rule.ts.flags);
}
