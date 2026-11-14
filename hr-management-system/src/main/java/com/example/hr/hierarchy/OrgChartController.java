package com.example.hr.hierarchy;

import com.example.hr.employee.dto.OrgChartNode;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
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
    @Operation(summary = "The root level of the org chart, with the number of direct reports")
    List<OrgChartNode> orgChartRoots() {
        return hierarchy.orgChartRoots();
    }

    @GetMapping("/{employeeId}/children")
    @Operation(summary = "The direct reports of one employee (one level of the org chart)")
    List<OrgChartNode> orgChartChildren(@PathVariable UUID employeeId) {
        return hierarchy.orgChartChildren(employeeId);
    }
}
