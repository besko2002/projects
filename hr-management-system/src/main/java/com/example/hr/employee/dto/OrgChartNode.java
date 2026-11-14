package com.example.hr.employee.dto;

import java.util.UUID;

/**
 * One person of the company tree, as the org chart draws it.
 *
 * <p>The chart is loaded level by level: a node carries the number of its direct reports, and
 * their rows are fetched when the node is expanded. No salary field anywhere in the org chart.
 *
 * @param id             the employee's id
 * @param employeeNumber the employee's number (EMP-0001)
 * @param fullName       the employee's name
 * @param jobTitle       the job title, may be absent
 * @param departmentName the department, may be absent
 * @param childCount     how many direct reports this person has
 */
public record OrgChartNode(
        UUID id,
        String employeeNumber,
        String fullName,
        String jobTitle,
        String departmentName,
        int childCount) {
}
