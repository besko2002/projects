package com.example.hr;

import com.example.hr.employee.Role;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The org hierarchy on a real 4-level tree with a sibling branch:
 *
 * <pre>
 *   Cora Ceo
 *     ├── Dirk Director
 *     │     └── Mary Manager
 *     │           ├── Stan Staff
 *     │           └── Sara Staff
 *     └── Diana Director (sibling branch)
 *           └── Mike Manager
 * </pre>
 */
class HierarchyIntegrationTest extends AbstractIntegrationTest {

    private String admin;
    private NewEmployee ceo;
    private NewEmployee director;
    private NewEmployee manager;
    private NewEmployee staff;
    private NewEmployee otherStaff;
    private NewEmployee siblingDirector;
    private NewEmployee siblingManager;

    @BeforeEach
    void buildTree() throws Exception {
        admin = adminToken();
        ceo = createEmployee(admin, "Cora Ceo", Role.EMPLOYEE, null, null, "20000.00");
        director = createEmployee(admin, "Dirk Director", Role.EMPLOYEE, ceo.id(), null, "15000.00");
        manager = createEmployee(admin, "Mary Manager", Role.EMPLOYEE, director.id(), null, "10000.00");
        staff = createEmployee(admin, "Stan Staff", Role.EMPLOYEE, manager.id(), null, "5000.00");
        otherStaff = createEmployee(admin, "Sara Staff", Role.EMPLOYEE, manager.id(), null, "5100.00");
        siblingDirector = createEmployee(admin, "Diana Director", Role.EMPLOYEE, ceo.id(), null, "14000.00");
        siblingManager = createEmployee(admin, "Mike Manager", Role.EMPLOYEE, siblingDirector.id(), null, "9000.00");
    }

    // ------------------------------------------------------------------ helpers

    private ResultActions setManager(String token, UUID employeeId, UUID managerId) throws Exception {
        Map<String, Object> body = new HashMap<>();
        body.put("managerId", managerId);
        return mvc.perform(put("/api/employees/" + employeeId + "/manager")
                .header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body)));
    }

    private static JsonNode nodeNamed(JsonNode arrayOrObject, String fullName) {
        JsonNode array = arrayOrObject.isArray() ? arrayOrObject : arrayOrObject.path("content");
        for (JsonNode node : array) {
            if (fullName.equals(node.path("fullName").asText())) {
                return node;
            }
        }
        throw new AssertionError("no node named " + fullName + " in " + arrayOrObject);
    }

    private static List<String> namesWithDepth(JsonNode team, int depth) {
        List<String> names = new ArrayList<>();
        for (JsonNode member : team) {
            if (member.path("depth").asInt() == depth) {
                names.add(member.path("fullName").asText());
            }
        }
        return names;
    }

    // ------------------------------------------------------------------ cycle prevention

    @Test
    void anEmployeeCannotBeTheirOwnManager() throws Exception {
        setManager(admin, manager.id(), manager.id())
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value("An employee cannot be their own manager"));
    }

    @Test
    void aDirectCycleIsRefusedWithConflict() throws Exception {
        setManager(admin, director.id(), manager.id())
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value(
                        org.hamcrest.Matchers.containsString("would create a cycle")));
    }

    @Test
    void aDeepCycleThreeLevelsDownIsRefusedWithConflict() throws Exception {
        setManager(admin, ceo.id(), staff.id())
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value(
                        org.hamcrest.Matchers.containsString("would create a cycle")));

        // The tree is untouched after the refusal.
        getAs(admin, "/api/employees/" + ceo.id())
                .andExpect(jsonPath("$.managerId").value(org.hamcrest.Matchers.nullValue()));
    }

    @Test
    void movingSomebodyAcrossBranchesIsAllowed() throws Exception {
        setManager(admin, staff.id(), siblingManager.id())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.managerId").value(siblingManager.id().toString()));

        JsonNode chain = body(getAs(admin, "/api/employees/" + staff.id() + "/chain"));
        assertThat(chain.findValuesAsText("fullName"))
                .containsExactly("Mike Manager", "Diana Director", "Cora Ceo");
    }

    @Test
    void aTerminatedEmployeeCannotBeMadeManager() throws Exception {
        mvc.perform(post("/api/employees/" + siblingManager.id() + "/terminate")
                        .header("Authorization", bearer(admin)))
                .andExpect(status().isOk());

        setManager(admin, staff.id(), siblingManager.id())
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value("A terminated employee cannot be a manager"));
    }

    @Test
    void theManagerCanBeClearedWhichMakesTheEmployeeARoot() throws Exception {
        setManager(admin, director.id(), null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.managerId").value(org.hamcrest.Matchers.nullValue()));

        JsonNode roots = body(getAs(admin, "/api/org-chart"));
        assertThat(roots.findValuesAsText("fullName")).contains("Dirk Director");
        assertThat(nodeNamed(roots, "Dirk Director").path("childCount").asInt()).isEqualTo(1);
        JsonNode dirkChildren = body(getAs(admin, "/api/org-chart/" + director.id() + "/children"));
        assertThat(dirkChildren.findValuesAsText("fullName")).containsExactly("Mary Manager");
    }

    @Test
    void anUnknownManagerIdIsNotFoundAndANonHrCallerIsForbidden() throws Exception {
        setManager(admin, staff.id(), UUID.randomUUID()).andExpect(status().isNotFound());

        String staffToken = login(staff.email(), staff.password());
        setManager(staffToken, otherStaff.id(), staff.id()).andExpect(status().isForbidden());
    }

    // ------------------------------------------------------------------ team queries

    @Test
    void myTeamReturnsOnlyTheDirectReports() throws Exception {
        String ceoToken = login(ceo.email(), ceo.password());
        getAs(ceoToken, "/api/employees/me/team")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].fullName").value("Diana Director"))
                .andExpect(jsonPath("$[1].fullName").value("Dirk Director"))
                .andExpect(jsonPath("$[0].depth").value(1))
                .andExpect(jsonPath("$[0].salary").doesNotExist());

        String staffToken = login(staff.email(), staff.password());
        getAs(staffToken, "/api/employees/me/team")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void myWholeTeamReturnsEveryDescendantWithTheCorrectDepth() throws Exception {
        String ceoToken = login(ceo.email(), ceo.password());
        JsonNode team = body(getAs(ceoToken, "/api/employees/me/team/all").andExpect(status().isOk()));

        assertThat(team.size()).isEqualTo(6);
        assertThat(namesWithDepth(team, 1)).containsExactlyInAnyOrder("Dirk Director", "Diana Director");
        assertThat(namesWithDepth(team, 2)).containsExactlyInAnyOrder("Mary Manager", "Mike Manager");
        assertThat(namesWithDepth(team, 3)).containsExactlyInAnyOrder("Stan Staff", "Sara Staff");

        JsonNode directorTeam = body(getAs(login(director.email(), director.password()),
                "/api/employees/me/team/all"));
        assertThat(directorTeam.size()).isEqualTo(3);
        assertThat(namesWithDepth(directorTeam, 1)).containsExactly("Mary Manager");
        assertThat(namesWithDepth(directorTeam, 2)).containsExactlyInAnyOrder("Stan Staff", "Sara Staff");

        assertThat(body(getAs(login(staff.email(), staff.password()), "/api/employees/me/team/all")).size())
                .isZero();
    }

    @Test
    void teamResponsesNeverCarrySalaries() throws Exception {
        String ceoToken = login(ceo.email(), ceo.password());
        getAs(ceoToken, "/api/employees/me/team/all")
                .andExpect(jsonPath("$[0].salary").doesNotExist())
                .andExpect(jsonPath("$[5].salary").doesNotExist());
        assertThat(body(getAs(ceoToken, "/api/employees/me/team/all")).toString())
                .doesNotContain("salary");
        assertThat(body(getAs(ceoToken, "/api/employees/me/team")).toString()).doesNotContain("salary");
    }

    @Test
    void theManagementChainGoesUpwardsToTheRoot() throws Exception {
        JsonNode chain = body(getAs(admin, "/api/employees/" + staff.id() + "/chain")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(3))
                .andExpect(jsonPath("$[0].fullName").value("Mary Manager"))
                .andExpect(jsonPath("$[0].level").value(1))
                .andExpect(jsonPath("$[1].fullName").value("Dirk Director"))
                .andExpect(jsonPath("$[1].level").value(2))
                .andExpect(jsonPath("$[2].fullName").value("Cora Ceo"))
                .andExpect(jsonPath("$[2].level").value(3))
                .andExpect(jsonPath("$[0].salary").doesNotExist()));
        assertThat(chain.toString()).doesNotContain("salary");

        getAs(admin, "/api/employees/" + ceo.id() + "/chain")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void anEmployeeCanReadTheirOwnChainButNotSomebodyElsesBranch() throws Exception {
        String staffToken = login(staff.email(), staff.password());
        getAs(staffToken, "/api/employees/" + staff.id() + "/chain").andExpect(status().isOk());
        getAs(staffToken, "/api/employees/" + siblingManager.id() + "/chain").andExpect(status().isNotFound());
    }

    // ------------------------------------------------------------------ org chart

    @Test
    void theOrgChartNestsTheWholeCompany() throws Exception {
        String staffToken = login(staff.email(), staff.password());
        JsonNode roots = body(getAs(staffToken, "/api/org-chart").andExpect(status().isOk()));

        // Roots are the employees without a manager: the bootstrap admin and the CEO.
        assertThat(roots.path("content").size()).isEqualTo(2);
        JsonNode ceoNode = nodeNamed(roots, "Cora Ceo");
        assertThat(ceoNode.path("jobTitle").asText()).isEqualTo("Cora Ceo title");
        assertThat(ceoNode.path("childCount").asInt()).isEqualTo(2);

        JsonNode ceoChildren = body(getAs(staffToken, "/api/org-chart/" + ceo.id() + "/children"));
        assertThat(ceoChildren.path("content").size()).isEqualTo(2);
        assertThat(ceoChildren.findValuesAsText("fullName")).containsExactlyInAnyOrder("Dirk Director", "Diana Director");

        JsonNode dirkNode = nodeNamed(ceoChildren, "Dirk Director");
        assertThat(dirkNode.path("childCount").asInt()).isEqualTo(1);

        JsonNode dirkChildren = body(getAs(staffToken, "/api/org-chart/" + director.id() + "/children"));
        JsonNode managerNode = nodeNamed(dirkChildren, "Mary Manager");
        assertThat(managerNode.path("childCount").asInt()).isEqualTo(2);

        JsonNode managerChildren = body(getAs(staffToken, "/api/org-chart/" + manager.id() + "/children"));
        assertThat(managerChildren.findValuesAsText("fullName")).containsExactlyInAnyOrder("Stan Staff", "Sara Staff");

        JsonNode dianaChildren = body(getAs(staffToken, "/api/org-chart/" + siblingDirector.id() + "/children"));
        assertThat(dianaChildren.findValuesAsText("fullName")).containsExactly("Mike Manager");

        assertThat(roots.toString()).doesNotContain("salary").doesNotContain("email");
        assertThat(ceoChildren.toString()).doesNotContain("salary").doesNotContain("email");
        assertThat(dirkChildren.toString()).doesNotContain("salary").doesNotContain("email");
        assertThat(managerChildren.toString()).doesNotContain("salary").doesNotContain("email");
    }

    @Test
    void theOrgChartShowsDepartmentsAndSkipsTerminatedEmployees() throws Exception {
        UUID department = createDepartment(admin, "Engineering");
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .patch("/api/employees/" + manager.id()).header("Authorization", bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("departmentId", department))))
                .andExpect(status().isOk());
        mvc.perform(post("/api/employees/" + siblingDirector.id() + "/terminate")
                        .header("Authorization", bearer(admin)))
                .andExpect(status().isOk());

        JsonNode roots = body(getAs(admin, "/api/org-chart"));
        JsonNode dirkChildren = body(getAs(admin, "/api/org-chart/" + director.id() + "/children"));
        assertThat(nodeNamed(dirkChildren, "Mary Manager").path("departmentName").asText()).isEqualTo("Engineering");

        // Diana is gone and her report was re-parented to the CEO.
        JsonNode ceoChildren = body(getAs(admin, "/api/org-chart/" + ceo.id() + "/children"));
        assertThat(roots.toString()).doesNotContain("Diana Director");
        assertThat(ceoChildren.toString()).doesNotContain("Diana Director");
        assertThat(ceoChildren.findValuesAsText("fullName")).containsExactlyInAnyOrder("Dirk Director", "Mike Manager");
    }

    @Test
    void theOrgChartHandlesAThirtyPersonTreeInOneQuery() throws Exception {
        // Three more levels of breadth on top of the fixture tree: ~30 employees in total.
        List<UUID> parents = new ArrayList<>(List.of(staff.id(), otherStaff.id(), siblingManager.id()));
        List<UUID> nextLevel = new ArrayList<>();
        int created = 0;
        for (int level = 0; level < 2; level++) {
            int childrenPerParent = level == 0 ? 3 : 2;
            for (UUID parent : parents) {
                for (int i = 0; i < childrenPerParent; i++) {
                    nextLevel.add(createEmployee(admin, "Level" + level + " Person" + created++,
                            Role.EMPLOYEE, parent).id());
                }
            }
            parents = new ArrayList<>(nextLevel);
            nextLevel.clear();
        }

        long employees = jdbc.queryForObject("select count(*) from employees", Long.class);
        assertThat(employees).isEqualTo(8 + created);

        JsonNode roots = body(getAs(admin, "/api/org-chart").andExpect(status().isOk()));
        assertThat(roots.path("content").size()).isEqualTo(2);

        // The deepest branch is still resolved level-by-level: ceo -> director -> manager -> staff -> L0 -> L1.
        JsonNode ceoChildren = body(getAs(admin, "/api/org-chart/" + ceo.id() + "/children"));
        JsonNode dirkChildren = body(getAs(admin, "/api/org-chart/" + director.id() + "/children"));
        JsonNode managerChildren = body(getAs(admin, "/api/org-chart/" + manager.id() + "/children"));
        JsonNode stanNode = nodeNamed(managerChildren, "Stan Staff");
        assertThat(stanNode.path("childCount").asInt()).isEqualTo(3);

        JsonNode stanChildren = body(getAs(admin, "/api/org-chart/" + staff.id() + "/children"));
        assertThat(stanChildren.path("content").size()).isEqualTo(3);
        UUID l0ChildId = UUID.fromString(stanChildren.path("content").get(0).path("id").asText());
        assertThat(stanChildren.path("content").get(0).path("childCount").asInt()).isEqualTo(2);

        JsonNode l1Children = body(getAs(admin, "/api/org-chart/" + l0ChildId + "/children"));
        assertThat(l1Children.path("content").size()).isEqualTo(2);
    }

    @Test
    void orgChartRootsAndChildrenSupportBoundedPagination() throws Exception {
        // Fetch roots with size=1
        JsonNode page0 = body(getAs(admin, "/api/org-chart?page=0&size=1").andExpect(status().isOk()));
        assertThat(page0.path("content").size()).isEqualTo(1);
        assertThat(page0.path("totalElements").asInt()).isGreaterThanOrEqualTo(2);
        assertThat(page0.path("totalPages").asInt()).isGreaterThanOrEqualTo(2);

        JsonNode page1 = body(getAs(admin, "/api/org-chart?page=1&size=1").andExpect(status().isOk()));
        assertThat(page1.path("content").size()).isEqualTo(1);
        String first = page0.path("content").get(0).path("id").asText();
        String second = page1.path("content").get(0).path("id").asText();
        assertThat(first).isNotEqualTo(second);

        // Fetch children of CEO with size=1
        JsonNode childPage0 = body(getAs(admin, "/api/org-chart/" + ceo.id() + "/children?page=0&size=1")
                .andExpect(status().isOk()));
        assertThat(childPage0.path("content").size()).isEqualTo(1);
        assertThat(childPage0.path("totalElements").asInt()).isEqualTo(2);
        assertThat(childPage0.path("totalPages").asInt()).isEqualTo(2);

        JsonNode childPage1 = body(getAs(admin, "/api/org-chart/" + ceo.id() + "/children?page=1&size=1")
                .andExpect(status().isOk()));
        assertThat(childPage1.path("content").size()).isEqualTo(1);
        String child0 = childPage0.path("content").get(0).path("id").asText();
        String child1 = childPage1.path("content").get(0).path("id").asText();
        assertThat(child0).isNotEqualTo(child1);
    }

    @Test
    void theOrgChartRequiresAuthentication() throws Exception {
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/org-chart"))
                .andExpect(status().isUnauthorized());
    }
}
