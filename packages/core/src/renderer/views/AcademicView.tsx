import { useState } from "react";
import type { PluginComponentProps } from "@campusos/shared";
import { Component as AcademicGradesView } from "@campusos/plugin-academic-grades";
import { Component as ExamCountdownView } from "@campusos/plugin-exam-countdown";

type AcademicSection = "grades" | "exams";

const academicSections: ReadonlyArray<{
  id: AcademicSection;
  label: string;
}> = [
  { id: "grades", label: "成绩" },
  { id: "exams", label: "考试" }
];

/**
 * Renderer Module Interface for the consolidated Academic plugin.
 * Existing grades and countdown views remain the implementation behind this
 * boundary while their former first-level plugin entries are retired.
 */
export const AcademicView = (props: PluginComponentProps): JSX.Element => {
  const [section, setSection] = useState<AcademicSection>("grades");

  return (
    <section className="module-workspace academic-module-workspace">
      <nav className="module-tabs" aria-label="学业视图">
        {academicSections.map((item) => (
          <button
            key={item.id}
            className={section === item.id ? "is-active" : undefined}
            type="button"
            aria-pressed={section === item.id}
            onClick={() => setSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {section === "grades" ? (
        <AcademicGradesView {...props} />
      ) : (
        <ExamCountdownView {...props} />
      )}
    </section>
  );
};
