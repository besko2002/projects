import { api } from '../api/api';
import type { EmployeeRecord } from '../api/types';
import { useResource } from './useResource';

const PAGE_SIZE = 100;

/** Load the complete active roster before offering manager choices. */
export function useManagerCandidates(key: string): ReturnType<typeof useResource<EmployeeRecord[]>> {
  return useResource<EmployeeRecord[]>(async (signal) => {
    const employees: EmployeeRecord[] = [];
    let totalPages: number | null = null;
    let totalElements: number | null = null;

    for (let page = 0; totalPages === null || page < totalPages; page += 1) {
      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const response = await api.listEmployees(
        { status: 'ACTIVE', page, size: PAGE_SIZE, sort: 'fullName,asc' },
        signal,
      );
      if (
        !Array.isArray(response.content) || response.page !== page ||
        !Number.isSafeInteger(response.totalPages) || response.totalPages < 0 ||
        !Number.isSafeInteger(response.totalElements) || response.totalElements < 0 ||
        (totalPages !== null && response.totalPages !== totalPages) ||
        (totalElements !== null && response.totalElements !== totalElements) ||
        (response.totalPages === 0 && response.totalElements !== 0)
      ) {
        throw new Error('Could not load the complete manager list. Please try again.');
      }
      totalPages = response.totalPages;
      totalElements = response.totalElements;
      employees.push(...response.content);
    }

    if (employees.length !== totalElements) {
      throw new Error('Could not load the complete manager list. Please try again.');
    }
    return employees;
  }, key);
}
