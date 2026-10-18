import { describe, expect, it } from 'vitest';
import { stepAsideReason, targetKeyFor, type AsideInputs } from './stepAside';

const QPM = { x: 30, y: 20 };
const clear: AsideInputs = {
  cutsceneActive: false, tramActive: false, targetKey: 'cutsceneCameraTarget', targetValue: QPM, lastWritten: QPM, uiOwnsInput: false,
};
const at = (over: Partial<AsideInputs>): AsideInputs => ({ ...clear, ...over });

describe('stepAsideReason', () => {
  it('names each reason on its own', () => {
    expect(stepAsideReason(at({ cutsceneActive: true }))).toBe('cutscene');
    expect(stepAsideReason(at({ tramActive: true }))).toBe('tram');
    expect(stepAsideReason(at({ targetValue: { x: 50, y: 30 } }))).toBe('foreign');
    expect(stepAsideReason(at({ uiOwnsInput: true }))).toBe('ui');
  });

  it('ranks cutscene > tram > foreign > ui', () => {
    const all = at({ cutsceneActive: true, tramActive: true, targetValue: { x: 50, y: 30 }, uiOwnsInput: true });
    expect(stepAsideReason(all)).toBe('cutscene');
    expect(stepAsideReason({ ...all, cutsceneActive: false })).toBe('tram');
    expect(stepAsideReason({ ...all, cutsceneActive: false, tramActive: false })).toBe('foreign');
    expect(stepAsideReason({ ...all, cutsceneActive: false, tramActive: false, targetValue: QPM })).toBe('ui');
  });

  it('resumes once everything clears', () => {
    expect(stepAsideReason(clear)).toBeNull();
  });

  it('compares the target by value, not identity', () => {
    expect(stepAsideReason(at({ targetValue: { x: 30, y: 20 } }))).toBeNull();
    expect(stepAsideReason(at({ targetValue: { x: 30, y: 20.0001 } }))).toBe('foreign');
  });

  it('treats a target QPM never wrote as foreign, and a cleared target as the game letting go', () => {
    // e.g. Iris's arrival pan running when spectating starts
    expect(stepAsideReason(at({ lastWritten: null, targetValue: { x: 50, y: 30 } }))).toBe('foreign');
    // the cutscene end nulls the target (S F2): resume, not pause
    expect(stepAsideReason(at({ targetValue: null }))).toBeNull();
    expect(stepAsideReason(at({ targetValue: null, lastWritten: null }))).toBeNull();
  });

  it('never calls the freelook position foreign: it is never null, so the pause could not end', () => {
    const freelook = at({ targetKey: 'freelookCameraPosition', targetValue: { x: 50, y: 30 } });
    expect(stepAsideReason({ ...freelook, lastWritten: null })).toBeNull();
    expect(stepAsideReason(freelook)).toBeNull();
    expect(stepAsideReason({ ...freelook, uiOwnsInput: true })).toBe('ui');
    expect(stepAsideReason({ ...freelook, tramActive: true })).toBe('tram');
  });

  it('a seat change mid-spectate resumes in one frame on the new key', () => {
    // seated → spectating: the point written to the old key is not compared with the freelook value
    expect(stepAsideReason(at({ targetKey: 'freelookCameraPosition', targetValue: { x: 12, y: 7 }, lastWritten: QPM }))).toBeNull();
    // spectating → seated: the cutscene target is still null, so QPM takes it over
    expect(stepAsideReason(at({ targetKey: 'cutsceneCameraTarget', targetValue: null, lastWritten: { x: 12, y: 7 } }))).toBeNull();
  });
});

describe('targetKeyFor', () => {
  it('writes the cutscene target while seated and the freelook position as a real spectator', () => {
    expect(targetKeyFor('seated')).toBe('cutsceneCameraTarget');
    expect(targetKeyFor('spectating')).toBe('freelookCameraPosition');
    expect(targetKeyFor('unseated')).toBeNull();
  });
});
