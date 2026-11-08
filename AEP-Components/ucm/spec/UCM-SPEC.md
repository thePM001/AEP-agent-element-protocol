# UCM specification

Version ucm-rules-1 for AEP 2.9. This document is normative. The words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119. Every requirement has an id of the form UCM-R-nnn. The conformance checks CC-28 to CC-34 test them.

## 1. Scope

The Universal Computation Module (UCM) evaluates small typed programs exactly and signs every result. An agent uses it instead of producing numbers in token space. AEP can require a valid receipt for any field a task manifest declares as computed.

- UCM-R-001. An evaluation MUST read only the inputs the program declares. It MUST NOT open a file, a socket or a process.
- UCM-R-002. Every evaluation MUST terminate inside its budget (section 8).
- UCM-R-003. Exact results are the default. Binary64 floats MUST only occur inside a float block. The receipt MUST then say float_used true.

## 2. Program forms

A program has a text form for people and a JSON form for machines. Both describe the same tree.

- UCM-R-010. The JSON form MUST validate against AEP-Base-Node/AEP-Registry/schemas/ucm-program-v1.json.
- UCM-R-011. program_hash is SHA3-256 over the JSON Canonicalization Scheme (JCS) bytes of the JSON form, written as lowercase hex.
- UCM-R-012. UCM JSON records carry no JSON numbers. Every number is a string. An implementation MUST refuse a JSON number inside a record it hashes or signs.
- UCM-R-013. Nesting deeper than 64 levels MUST be refused with form_error or parse_error.

## 3. Text grammar

```
program    = { input_decl } { let_decl } expr [ ";" ] ;
input_decl = "input" name ":" type_text ";" ;
let_decl   = "let" name "=" expr ";" ;
expr       = "if" expr "then" expr "else" expr | or_expr ;
or_expr    = and_expr { "or" and_expr } ;
and_expr   = not_expr { "and" not_expr } ;
not_expr   = "not" not_expr | cmp_expr ;
cmp_expr   = add_expr [ cmp_op add_expr ] ;
cmp_op     = "==" | "!=" | "<" | "<=" | ">" | ">=" ;
add_expr   = mul_expr { ( "+" | "-" ) mul_expr } ;
mul_expr   = unary { ( "*" | "/" ) unary } ;
unary      = "-" unary | power ;
power      = primary [ "^" unary ] ;
primary    = number | string | "true" | "false" | name
           | name "(" [ arg { "," arg } ] ")"
           | "(" expr ")" | "[" [ expr { "," expr } ] "]"
           | "float" "{" expr "}" ;
arg        = expr | name "=>" expr | "(" name "," name ")" "=>" expr ;
number     = digit { digit | "_" } [ "." { digit } ] [ ( "e" | "E" ) [ "+" | "-" ] digit { digit } ] ;
string     = '"' { char | '\"' | '\\' } '"' ;
name       = letter { letter | digit | "_" } ;
```

- UCM-R-020. A comment runs from # to the end of the line.
- UCM-R-021. Comparisons do not chain. 1 < 2 < 3 MUST be a parse_error.
- UCM-R-022. A minus sign directly in front of a number literal makes a negative literal. -2 ^ 2 is -(2 ^ 2).
- UCM-R-023. A number with a point or an exponent is a decimal literal that keeps its written scale: 12.50 has scale 2.
- UCM-R-024. A lambda MUST only appear as an argument of map, filter, fold, any, all or count. There is no user recursion.

Input types are int, rational, decimal, money, money[CUR], quantity[unit], interval, float, bool, date, instant, text and vector[type].

## 4. Values

| Type | Meaning |
|------|---------|
| int | Arbitrary precision integer |
| rational | Exact fraction, always reduced |
| decimal | Fixed scale decimal; the scale is part of the value |
| money | Exact amount plus an ISO 4217 code |
| quantity | Exact value in SI base units plus a dimension over m, kg, s, A, K, mol and cd |
| interval | Closed interval of exact numbers |
| float | IEEE binary64, only from a float block |
| bool, date, instant, text | Truth value, proleptic Gregorian date, exact point in time, text |
| vector | Finite list of one kind of value; a matrix is a vector of vectors |

- UCM-R-030. A dimensionless quantity MUST become a rational.
- UCM-R-031. Money in two currencies MUST NOT mix. A program converts with convert(m, "CUR", rate) and a rate the caller supplies.
- UCM-R-032. Quantities with different dimensions MUST NOT be added, subtracted or compared. The checker refuses this with type_error before evaluation.

## 5. Operators

Exact number types join as int below decimal below rational.

| Operation | Rule |
|-----------|------|
| int + int, int - int, int * int | int |
| decimal with int or decimal under + or - | decimal at the larger scale |
| decimal with int or decimal under * | decimal at the sum of the scales |
| anything exact with rational | rational |
| a / b for exact numbers | rational; b = 0 is division_by_zero |
| int ^ n and decimal ^ n with n a non-negative int literal | int for an int base; decimal at scale times n for a decimal base |
| any other exact power | rational; the exponent MUST be an int |
| money with an exact number under *, money / number | money |
| money / money in one currency | rational |
| quantity * quantity, quantity / quantity | quantity with the summed or differenced dimension |
| quantity ^ n | needs an int literal n; the dimension is scaled by n |
| date + quantity of time, date - date | date when the time is whole days; date - date is a quantity in seconds |
| interval arithmetic | the result interval holds every possible value; dividing by an interval that holds 0 is domain_error |
| and with or | bool, evaluated left to right with short circuit |

- UCM-R-040. Inside a float block every exact number is converted to the nearest binary64 before an operation. The block gives a float or a bool. Outside a float block a float only combines with another float. exact(f) gives the exact rational of a float.
- UCM-R-041. The static type of a program is its result type. An evaluation MUST return a value of that type, converting int to rational or decimal and decimal to rational where the static type is wider.

## 6. Rounding

- UCM-R-050. Every operation that can lose digits names one mode: half_even, half_up, half_down, up, down, floor or ceiling. up and down are away from and toward zero.
- UCM-R-051. round(x, s, mode) gives the decimal at scale s that the mode selects. sqrt(x, s, mode) rounds the exact square root by the same rule.

## 7. Result form

Every scalar is a string.

| Type | Form |
|------|------|
| int | {"type": "int", "value": "n"} |
| rational | {"type": "rational", "value": "n" or "n/d", "decimal": exact decimal when the fraction terminates} |
| decimal | {"type": "decimal", "value": text at its scale} |
| money | {"type": "money", "currency": "CUR", "value": ..., "decimal": ...} |
| quantity | {"type": "quantity", "unit": SI dimension text such as m*kg/s^2, "value": exact value in SI base units} |
| interval | {"type": "interval", "lo": ..., "hi": ...} |
| float | {"type": "float", "value": shortest text that reads back to the same binary64} |
| bool, date, text | {"type": ..., "value": ...} |
| instant | {"type": "instant", "value": RFC 3339 UTC text, "seconds": exact seconds since 1970} |
| vector | {"type": "vector", "items": [...]} |

## 8. Budget

| Field | Default | Ceiling |
|-------|---------|---------|
| steps | 1000000 | 50000000 |
| bits (largest number) | 65536 | 1048576 |
| len (longest vector) | 100000 | 10000000 |
| millis (wall time) | 2000 | 30000 |

- UCM-R-060. A caller MAY lower each limit. Only the node operator MAY raise the ceiling.
- UCM-R-061. A program over any limit MUST fail with budget_exceeded and no partial result.
- UCM-R-062. budget_used records steps, peak bits and peak length. It records no wall time, so a replay reproduces it.

## 9. Functions

The catalog that GET /ucm/v1/catalog serves is the full list with examples. This table is generated from it.

| Category | Function | Signature | Meaning |
|----------|----------|-----------|---------|
| float | exact | `exact(f) -> rational` | Exact rational value of a binary64 float. Use it to bring a float block result back. |
| float | exp | `exp(x) -> float, only inside float { }` | e to the power x, binary64. |
| float | ln | `ln(x) -> float, only inside float { }` | Natural logarithm, binary64. |
| float | log10 | `log10(x) -> float, only inside float { }` | Base 10 logarithm, binary64. |
| float | log2 | `log2(x) -> float, only inside float { }` | Base 2 logarithm, binary64. |
| float | sin | `sin(x) -> float, only inside float { }` | Sine of an angle in radians, binary64. |
| float | cos | `cos(x) -> float, only inside float { }` | Cosine of an angle in radians, binary64. |
| float | tan | `tan(x) -> float, only inside float { }` | Tangent of an angle in radians, binary64. |
| float | asin | `asin(x) -> float, only inside float { }` | Arcsine in radians, binary64. |
| float | acos | `acos(x) -> float, only inside float { }` | Arccosine in radians, binary64. |
| float | atan | `atan(x) -> float, only inside float { }` | Arctangent in radians, binary64. |
| float | atan2 | `atan2(y, x) -> float, only inside float { }` | Angle of the point (x, y) in radians, binary64. |
| float | pi | `pi() -> float, only inside float { }` | The binary64 value nearest to pi. |
| interval | interval | `interval(lo, hi) -> interval` | Closed interval of exact numbers for error bounds. Arithmetic on intervals keeps every possible value inside. |
| interval | lo | `lo(i) -> rational` | Lower bound of an interval. |
| interval | hi | `hi(i) -> rational` | Upper bound of an interval. |
| interval | width | `width(i) -> rational` | Width hi - lo of an interval. |
| interval | contains | `contains(i, x) -> bool` | Whether an exact number lies inside a closed interval. |
| library | const | `const("id") -> number or quantity` | Named constant from the cited constants library, for example c, h, k_B, N_A, G or g_n. |
| library | formula | `formula("id", args...) -> value` | Run a reviewed formula from the cited formula library with positional arguments. |
| linear algebra | dot | `dot(a, b) -> rational` | Exact dot product of two equal length vectors. |
| linear algebra | identity | `identity(n) -> matrix` | n by n identity matrix. |
| linear algebra | transpose | `transpose(m) -> matrix` | Matrix transpose. |
| linear algebra | matmul | `matmul(a, b) -> matrix` | Exact matrix product. |
| linear algebra | det | `det(m) -> rational` | Exact determinant of a square matrix. |
| linear algebra | rank | `rank(m) -> int` | Exact rank of a matrix. |
| linear algebra | inverse | `inverse(m) -> matrix` | Exact inverse of a square matrix. A singular matrix is a domain error. |
| linear algebra | solve | `solve(a, b) -> vector[rational]` | Exact solution x of a * x = b for a square non singular matrix a. |
| money | money | `money(amount, "CUR") -> money[CUR]` | Money amount in an ISO 4217 currency. The amount is exact. |
| money | amount | `amount(m) -> rational` | Exact amount of a money value without its currency. |
| money | currency | `currency(m) -> text` | ISO 4217 code of a money value. |
| money | convert | `convert(m, "CUR", rate) -> money[CUR]` | Convert money with a rate the caller supplies, in target units per source unit. UCM never fetches rates. |
| money | allocate | `allocate(m, parts_or_weights, scale) -> vector[money]` | Split money into parts at a fixed scale so the parts add up exactly to the total. Leftover minor units go to the largest remainders, ties to the earlier part. |
| number | abs | `abs(x) -> same kind` | Absolute value of a number, money amount or quantity. |
| number | sign | `sign(x) -> int` | Sign of an exact number: -1, 0 or 1. |
| number | floor | `floor(x) -> int` | Largest integer not above x. |
| number | ceil | `ceil(x) -> int` | Smallest integer not below x. |
| number | trunc | `trunc(x) -> int` | Integer part of x, toward zero. |
| number | round | `round(x, scale, mode) -> decimal; money for money` | Round to a number of decimal places with an explicit mode: half_even, half_up, half_down, up, down, floor or ceiling. |
| number | min | `min(a, b) or min(vector)` | Smaller of two comparable values. With one vector argument, its smallest item. |
| number | max | `max(a, b) or max(vector)` | Larger of two comparable values. With one vector argument, its largest item. |
| number | numerator | `numerator(x) -> int` | Numerator of the reduced fraction. |
| number | denominator | `denominator(x) -> int` | Denominator of the reduced fraction. |
| number | rational | `rational(x) -> rational` | Exact rational value of an int or decimal. |
| number | sqrt | `sqrt(x, scale, mode) -> decimal; sqrt(x) -> float inside float { }` | Square root rounded to scale decimal places with an explicit mode. Inside a float block, sqrt(x) is the binary64 root. |
| number theory | gcd | `gcd(a, b) -> int` | Greatest common divisor. |
| number theory | lcm | `lcm(a, b) -> int` | Least common multiple. |
| number theory | mod | `mod(a, b) -> int` | Euclidean remainder, always between 0 and |b| - 1. |
| number theory | quot | `quot(a, b) -> int` | Floor division: floor(a / b). |
| number theory | factorial | `factorial(n) -> int` | Factorial of n, the product 1 * 2 * ... * n, for n from 0 to 20000. |
| number theory | binomial | `binomial(n, k) -> int` | Binomial coefficient n choose k. |
| number theory | isqrt | `isqrt(n) -> int` | Integer square root floor(sqrt(n)) for n >= 0. |
| number theory | is_prime | `is_prime(n) -> bool` | Deterministic primality test, exact below 3.1e23. |
| statistics | sum | `sum(v) -> number, money or quantity` | Exact sum of the items. The sum of an empty vector is 0. |
| statistics | product | `product(v) -> number` | Exact product of the items. The product of an empty vector is 1. |
| statistics | mean | `mean(v) -> rational, money or quantity` | Exact arithmetic mean. |
| statistics | median | `median(v) -> rational, money or quantity` | Exact median; the mean of the two middle items when the count is even. |
| statistics | variance | `variance(v) -> rational` | Exact population variance (divide by n). |
| statistics | variance_sample | `variance_sample(v) -> rational` | Exact sample variance (divide by n - 1). |
| statistics | stddev | `stddev(v, scale, mode) -> decimal` | Population standard deviation of exact numbers, rounded to scale places with an explicit mode. |
| statistics | stddev_sample | `stddev_sample(v, scale, mode) -> decimal` | Sample standard deviation of exact numbers, rounded to scale places with an explicit mode. |
| statistics | percentile | `percentile(v, p, "nearest_rank" \| "linear") -> rational` | p-th percentile, p from 0 to 100. nearest_rank picks an item; linear interpolates between closest ranks (the same rule as Excel PERCENTILE.INC). |
| time | date | `date("YYYY-MM-DD") or date(y, m, d) -> date` | Calendar date in the proleptic Gregorian calendar. |
| time | year | `year(d) -> int` | Year of a date. |
| time | month | `month(d) -> int` | Month 1 to 12 of a date. |
| time | day | `day(d) -> int` | Day of the month of a date. |
| time | weekday | `weekday(d) -> int` | ISO weekday: Monday 1 to Sunday 7. |
| time | day_of_year | `day_of_year(d) -> int` | Ordinal day 1 to 366. |
| time | add_days | `add_days(d, n) -> date` | Date n days later (n may be negative). |
| time | add_months | `add_months(d, n) -> date` | Date n calendar months later. A day past the end of the target month clamps to its last day. |
| time | days_between | `days_between(a, b) -> int` | Whole days from date a to date b (negative when b is earlier). |
| time | is_leap_year | `is_leap_year(y) -> bool` | Gregorian leap year test. |
| time | instant | `instant("YYYY-MM-DDTHH:MM[:SS]", "Zone/Name") -> instant` | Point in time from a local wall clock time in an IANA time zone. Ambiguous and skipped local times are errors. |
| time | instant_utc | `instant_utc("RFC 3339 with offset") -> instant` | Point in time from an RFC 3339 timestamp with an explicit offset. |
| time | local_date | `local_date(i, "Zone/Name") -> date` | Calendar date of an instant in a time zone. |
| time | local_text | `local_text(i, "Zone/Name") -> text` | RFC 3339 text of an instant in a time zone. |
| units | q | `q(value, "unit") -> quantity` | Quantity with a unit, stored exactly in SI base units. Units: SI with prefixes, min, h, day, L, t, bar, atm, eV, Wh, cal, in, ft, yd, mi, nmi, lb, oz, lbf, psi, gal, kn, mph. |
| units | to | `to(q, "unit") -> rational` | Exact value of a quantity in the named unit. The dimensions must match. |
| units | dimension | `dimension(q) -> text` | SI base dimension of a quantity, for example m*kg/s^2. |
| units | celsius | `celsius(x) -> quantity[K]` | Temperature given in degrees Celsius, as kelvin: x + 273.15. |
| units | fahrenheit | `fahrenheit(x) -> quantity[K]` | Temperature given in degrees Fahrenheit, as kelvin: (x + 459.67) * 5/9. |
| units | to_celsius | `to_celsius(t) -> rational` | Degrees Celsius of a temperature quantity. |
| units | to_fahrenheit | `to_fahrenheit(t) -> rational` | Degrees Fahrenheit of a temperature quantity. |
| vector | len | `len(v) -> int` | Number of items. |
| vector | at | `at(v, i) -> item` | Item at zero based index i. |
| vector | range | `range(a, b) -> vector[int]` | Integers a, a+1, ..., b-1. |
| vector | concat | `concat(a, b) -> vector` | Items of a followed by items of b. |
| vector | reverse | `reverse(v) -> vector` | Items in reverse order. |
| vector | sort | `sort(v) -> vector` | Items in ascending order. |
| vector | map | `map(v, x => expr) -> vector` | Apply an expression to every item. |
| vector | filter | `filter(v, x => bool) -> vector` | Items for which the condition holds. |
| vector | fold | `fold(v, init, (acc, x) => expr) -> value` | Reduce a vector left to right with an accumulator. |
| vector | any | `any(v, x => bool) -> bool` | Whether the condition holds for at least one item. |
| vector | all | `all(v, x => bool) -> bool` | Whether the condition holds for every item. |
| vector | count | `count(v, x => bool) -> int` | Number of items for which the condition holds. |

Units: SI base and derived units with the prefixes q to Q. Also min, h, day, week, L, t, ha, bar, atm, eV, Wh, cal, au, in, ft, yd, mi, nmi, lb, oz, lbf, psi, gal, kn and mph. Every factor is exact. A unit expression has at most one slash and everything after it is the denominator: kg/m*s^2 is kg/(m*s^2).

## 10. Library

The library AEP-Components/ucm/library/ucm-library-v1.json holds cited constants and reviewed formulas. const("id") reads a constant and formula("id", args...) runs a formula.

- UCM-R-070. Every constant MUST cite its source. A measured constant MUST state its standard uncertainty.
- UCM-R-071. Every formula MUST ship vectors that the conformance suite runs.
- UCM-R-072. A formula MUST NOT call formula(), so no formula can reach itself.
- UCM-R-073. The library digest is SHA3-256 over the JCS bytes of the library file. A receipt whose program read the library MUST list that digest.

## 11. Receipts

A receipt validates against AEP-Base-Node/AEP-Registry/schemas/ucm-receipt-v1.json.

- UCM-R-080. receipt_id is ucmr_ followed by the first 32 hex digits of SHA3-256 over the JCS bytes of every field except receipt_id and signature.
- UCM-R-081. signature is ML-DSA-65 over the JCS bytes of every field except signature, made with the node key.
- UCM-R-082. A verifier MUST recompute receipt_id, program_hash, input_digest, result_digest and node_id and MUST check the signature before trusting any field.
- UCM-R-083. A replay MUST use the same engine build and library digest and the step, bit and length limits of the receipt. It MUST compare result digests. A different digest is result_mismatch.
- UCM-R-084. program_source is library only when the program is the reviewed library formula unchanged, which the service checks by program_hash. Otherwise it is agent.

## 12. Enforcement in AEP

A task manifest MAY declare computed_fields, a list of JSON pointers into the action payload. UCB writes that list into payload.ucm.computed_fields at ingest and replaces whatever the agent sent. The agent puts one receipt per pointer into payload.ucm.receipts.

The reference policy AEP-Policy-System/reference/ucm-computed-claims.gap adds three invariants that Admit conjoins with every other wall.

| Invariant | Closes when | Deny kind |
|-----------|-------------|-----------|
| ucm_receipt_present | a declared field that the action carries has no receipt | UcmReceiptMissing |
| ucm_receipt_valid | a receipt fails any check of UCM-R-082, its signer is not in AEP_UCM_TRUSTED_KEYS, a replay fails or a library only wrap gets an agent program | UcmReceiptInvalid |
| ucm_result_matches | the field differs from the signed result or the result is text | UcmResultMismatch |

- UCM-R-090. With AEP_UCM_RECEIPT_PROFILE off, the default, the invariants close nothing. warn reports on stderr and closes nothing. strict closes the walls.
- UCM-R-091. Admit MUST decide exactly as before for every action that names no computed field.
- UCM-R-092. AEP_UCM_RECEIPT_VERIFY=replay adds a replay to every check, capped at 1000000 steps.
- UCM-R-093. AEP_UCM_LIBRARY_ONLY_WRAPS names wraps whose computed fields need a library program.

A field matches its result when it equals the result object. It also matches as the value or decimal text, with the currency or unit after a space for money and quantities. A JSON number matches when its text is that value or decimal text.

## 13. System-1 lookup

System-1 finds the tool. It never uses it.

- UCM-R-100. A lookup reply MUST only hold catalog entries exactly as the catalog has them, with a score. It MUST NOT hold a result, a number taken from the request or a program with request values filled in.
- UCM-R-101. Tier one is keyword scoring over the catalog and needs no model.
- UCM-R-102. Tier two MAY ask a ranker model. Only catalog ids from the tier one shortlist survive from its answer.

## 14. Errors

| Code | Meaning |
|------|---------|
| parse_error | the text form does not parse; line and column are given |
| form_error | the JSON form or a record is malformed |
| type_error | the checker refuses the program |
| unbound_name | an unknown variable, constant or formula |
| unknown_function | a call to a function that does not exist |
| input_error | an input is missing, undeclared or malformed |
| division_by_zero | a division or negative power by zero |
| domain_error | an argument outside the domain of a function |
| unit_error | an unknown unit or a conversion between dimensions |
| budget_exceeded | a budget limit was reached |
