package com.example.hr.hierarchy;

import com.example.hr.employee.dto.OrgChartNode;
import com.example.hr.employee.dto.PageResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/api/org-chart")
@Tag(name = "Org chart")
class OrgChartController {

    private final HierarchyService hierarchy;

    OrgChartController(HierarchyService hierarchy) {
        this.hierarchy = hierarchy;
    }

    @GetMapping
    @Operation(summary = "The root level of the org chart, with bounded pagination")
    PageResponse<OrgChartNode> orgChartRoots(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        return hierarchy.orgChartRoots(page, size);
    }

    @GetMapping("/{employeeId}/children")
    @Operation(summary = "The direct reports of one employee (one level of the org chart), with bounded pagination")
    PageResponse<OrgChartNode> orgChartChildren(
            @PathVariable UUID employeeId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        return hierarchy.orgChartChildren(employeeId, page, size);
    }
}
