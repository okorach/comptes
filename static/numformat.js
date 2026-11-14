/* Display of the numbers: the decimal separator ("." or ",") and the thousands separator ("" or a single character) are chosen in the
   Administration page and kept in the database. Every number shown by the application goes through formatNumber(). */
const NUMBER_FORMAT = {decimal: '.', thousands: ' '};   // defaults: 1 234 567.89

/* The separators come from the server: only accepted when they are valid (the decimal separator is . or ,; the thousands separator
   is empty or one character that is neither a digit, a sign nor a markup character), else the defaults are kept */
function setNumberFormat(format){
  const decimal = ['.', ','].includes(format?.decimal) ? format.decimal : '.';
  const thousands = String(format?.thousands ?? ' ').match(/^[^<>&"+\-\d\p{C}]?$/gu)?.[0] ?? ' ';
  NUMBER_FORMAT.decimal = decimal;
  NUMBER_FORMAT.thousands = thousands === decimal ? '' : thousands;
}

/* The digits of an integer by groups of three, from the right ("1234567" -> "1 234 567") */
function groupDigits(digits, separator){
  const groups = [];
  for (let end = digits.length; end > 0; end -= 3) groups.unshift(digits.slice(Math.max(0, end - 3), end));
  return groups.join(separator);
}

/* v with between min and max decimals, the thousands grouped. `format` is the current one unless given (preview). */
function formatNumber(v, min = 0, max = min, format = NUMBER_FORMAT){
  const plain = v.toLocaleString('en-US', {minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: false});   // -1234.5
  const [whole, fraction] = plain.split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const digits = sign ? whole.slice(1) : whole;
  const grouped = groupDigits(digits, format.thousands);
  return sign + grouped + (fraction ? format.decimal + fraction : '');
}

if (typeof module !== 'undefined') module.exports = {formatNumber, setNumberFormat, NUMBER_FORMAT};
