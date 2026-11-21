import dayjs from 'dayjs';
import advancedFormat from 'dayjs/plugin/advancedFormat.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import isoWeek from 'dayjs/plugin/isoWeek.js';
import { diagramBodyOffset } from './detection.js';

dayjs.extend(isoWeek);
dayjs.extend(customParseFormat);
dayjs.extend(advancedFormat);

function invalidGanttTaskEnd(db) {
  const format = db.getDateFormat().trim();
  return db.getTasks().find((task) => {
    // Mermaid's parser resolves the task columns and tags before calculating
    // dates. The calculated end alone cannot distinguish an invalid value
    // from a valid zero-duration task.
    const end = task.raw.endTime.data;
    // Milestones and vertical markers can intentionally use the start alone.
    if (!end && (task.milestone || task.vert)) return false;
    return !/^until\s+[\w -]+/.test(end) &&
      !Number.isFinite(db.parseDuration(end)[0]) && !dayjs(end, format, true).isValid();
  });
}

function ganttTaskLine(source, task) {
  const offset = diagramBodyOffset(source);
  const firstLine = source.slice(0, offset).split(/\r\n?|\n/).length;
  const lines = source.slice(offset).split(/\r\n?|\n/);
  const statement = (task.task + task.raw.data).trim();
  const index = lines.findIndex((line) => line.trim() === statement);
  return index < 0 ? undefined : firstLine + index;
}

export { ganttTaskLine, invalidGanttTaskEnd };
