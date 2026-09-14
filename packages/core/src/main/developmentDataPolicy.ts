export const DEVELOPMENT_COURSEWARE_ACADEMIC_YEAR = "2025-2026";

export const isDevelopmentCoursewareSemester = (semester: string): boolean => {
  const normalized = semester
    .trim()
    .replaceAll("–", "-")
    .replaceAll("—", "-")
    .replace(/\s+/g, "");
  return /^2025-2026(?:学年)?(?:春|夏|春夏)(?:学期)?$/.test(normalized);
};
