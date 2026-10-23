/**
 * Athlete profile rules (decided by David 2026-10-23).
 * Coaches type Birthday and Grad year; Age group and School year are derived.
 *
 * Age group: age on Jan 1 of the current calendar year. Under 15 -> U15,
 * 15 -> U16, 16 -> U17, 17 and older -> U19. (17 on Jan 1 is not U17.)
 * School year: rolls over July 1. Class of G is in 12th grade in the school
 * year ending in June of G.
 *
 * Birthday is coach-only: never send it to the team site.
 */

function ageOnJan1_(birthday, today) {
  var jan1 = new Date(today.getFullYear(), 0, 1);
  var age = jan1.getFullYear() - birthday.getFullYear();
  if (birthday.getMonth() > 0 || birthday.getDate() > 1) age -= 1;   // birthday after Jan 1
  return age;
}

/** 'U15' | 'U16' | 'U17' | 'U19', or '' without a birthday. */
function ageGroup(birthday, today) {
  if (Object.prototype.toString.call(birthday) !== '[object Date]' || isNaN(birthday)) return '';
  var age = ageOnJan1_(birthday, today || new Date());
  if (age < 15) return 'U15';
  if (age < 16) return 'U16';
  if (age < 17) return 'U17';
  return 'U19';
}

/** '7th'..'12th', 'Graduated', or '' (blank or before 7th). */
function schoolYear(gradYear, today) {
  if (gradYear === '' || gradYear === null || gradYear === undefined) return '';
  var t = today || new Date();
  var endYear = t.getFullYear() + (t.getMonth() >= 6 ? 1 : 0);   // July = month 6
  var grade = 12 - (Number(gradYear) - endYear);
  if (grade > 12) return 'Graduated';
  if (grade < 7) return '';
  return grade + 'th';
}

/** Sheet version of ageGroup(): one array formula in the header cell. */
function ageGroupFormula_(col) {
  var r = col + '2:' + col;
  var age = 'DATEDIF(' + r + ',DATE(YEAR(TODAY()),1,1),"Y")';
  return '={"Age group";ARRAYFORMULA(IF(' + r + '="","",IFERROR(IFS(' +
    age + '<15,"U15",' + age + '<16,"U16",' + age + '<17,"U17",TRUE,"U19"),"U15")))}';
}

/** Sheet version of schoolYear(). */
function schoolYearFormula_(col) {
  var r = col + '2:' + col;
  var g = '(12-(' + r + '-(YEAR(TODAY())+(MONTH(TODAY())>=7))))';
  return '={"School year";ARRAYFORMULA(IF(' + r + '="","",IFS(' +
    g + '>12,"Graduated",' + g + '<7,"",TRUE,' + g + '&"th")))}';
}
