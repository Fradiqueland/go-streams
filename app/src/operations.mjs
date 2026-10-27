import { AppError } from './errors.mjs';
export const operationDefaults = { maxConcurrent: 6, historyLimit: 500, persistSchedules: false };
export function operationSettings(settings = {}) {
  return { ...operationDefaults, ...settings.operations };
}
export function validateOperations(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('Definições de operação inválidas.');
  const {maxConcurrent, historyLimit, persistSchedules} = input;
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 0 || maxConcurrent > 256) throw new AppError('Escolha entre 1 e 256 transmissões, ou 0 para não impor um limite.');
  if (![500, 5000, 50000].includes(historyLimit)) throw new AppError('Escolha uma retenção de histórico suportada.');
  if (typeof persistSchedules !== 'boolean') throw new AppError('Indique se pretende conservar a ativação dos agendamentos.');
  return {maxConcurrent, historyLimit, persistSchedules};
}
