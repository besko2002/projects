package com.example.hr.auth;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
class EmployeePasswordResetController {
    private final EmployeePasswordResetService service;

    EmployeePasswordResetController(EmployeePasswordResetService service) {
        this.service = service;
    }

    record ResetRequest(@NotBlank @Size(max = 400) String reason) { }

    @PostMapping("/api/employees/{id}/reset-password")
    @PreAuthorize("hasAnyRole('HR', 'ADMIN')")
    ResponseEntity<EmployeePasswordResetService.PasswordReset> reset(
            @PathVariable UUID id, @Valid @RequestBody ResetRequest request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(service.reset(id, request.reason()));
    }
}
