package com.example.hr.payroll;

import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.DataFormat;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.streaming.SXSSFWorkbook;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.OutputStream;
import java.lang.management.ManagementFactory;
import java.lang.management.MemoryMXBean;
import java.math.BigDecimal;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Bounded load and scalability benchmark for Payroll processing and streaming export
 * under a constrained JVM heap (-Xmx384m).
 */
class PayrollScaleBenchmarkTest {

    private final PayrollCalculator calculator = new PayrollCalculator();
    private final PayrollRates rates = PayrollRatesFixture.defaults();

    @Test
    @DisplayName("5,000 employee roster bounded load test")
    void benchmark5000EmployeeRoster() throws Exception {
        runRosterBenchmark(5_000);
    }

    @Test
    @DisplayName("20,000 employee roster bounded load test")
    void benchmark20000EmployeeRoster() throws Exception {
        runRosterBenchmark(20_000);
    }

    private void runRosterBenchmark(int rosterSize) throws Exception {
        System.gc();
        MemoryMXBean memoryBean = ManagementFactory.getMemoryMXBean();
        long initialHeap = memoryBean.getHeapMemoryUsage().getUsed();
        long startTime = System.currentTimeMillis();

        AtomicInteger successCount = new AtomicInteger(0);
        AtomicInteger errorCount = new AtomicInteger(0);
        BigDecimal totalGross = BigDecimal.ZERO;
        BigDecimal totalNet = BigDecimal.ZERO;

        // Streaming SXSSFWorkbook with 100-row sliding window
        SXSSFWorkbook workbook = new SXSSFWorkbook(100);
        try (workbook) {
            Sheet sheet = workbook.createSheet("Roster Benchmark " + rosterSize);
            DataFormat formats = workbook.createDataFormat();
            CellStyle currency = workbook.createCellStyle();
            currency.setDataFormat(formats.getFormat("#,##0.00"));

            Row header = sheet.createRow(0);
            header.createCell(0).setCellValue("Employee No");
            header.createCell(1).setCellValue("Employee Name");
            header.createCell(2).setCellValue("Base Salary");
            header.createCell(3).setCellValue("Gross Earnings");
            header.createCell(4).setCellValue("Insurance");
            header.createCell(5).setCellValue("Tax");
            header.createCell(6).setCellValue("Net Pay");

            for (int i = 0; i < rosterSize; i++) {
                try {
                    BigDecimal baseSalary = BigDecimal.valueOf(3000 + (i % 20) * 500); // 3,000 to 12,500
                    PayrollInput input = new PayrollInput(
                            baseSalary,
                            22,
                            22,
                            0,
                            0,
                            (i % 10) * 15,
                            (i % 5) * 60,
                            0,
                            rates
                    );

                    PayrollResult result = calculator.calculate(input);
                    totalGross = totalGross.add(result.grossEarnings());
                    totalNet = totalNet.add(result.netPay());
                    successCount.incrementAndGet();

                    // Stream to SXSSFWorkbook row
                    Row row = sheet.createRow(i + 1);
                    row.createCell(0).setCellValue("EMP-" + (10000 + i));
                    row.createCell(1).setCellValue("Roster Worker " + i);

                    Cell c2 = row.createCell(2);
                    c2.setCellValue(baseSalary.doubleValue());
                    c2.setCellStyle(currency);

                    Cell c3 = row.createCell(3);
                    c3.setCellValue(result.grossEarnings().doubleValue());
                    c3.setCellStyle(currency);

                    Cell c4 = row.createCell(4);
                    c4.setCellValue(result.insurance().doubleValue());
                    c4.setCellStyle(currency);

                    Cell c5 = row.createCell(5);
                    c5.setCellValue(result.tax().doubleValue());
                    c5.setCellStyle(currency);

                    Cell c6 = row.createCell(6);
                    c6.setCellValue(result.netPay().doubleValue());
                    c6.setCellStyle(currency);
                } catch (Exception e) {
                    errorCount.incrementAndGet();
                }
            }

            // Write to null stream to test complete serialization
            workbook.write(OutputStream.nullOutputStream());
            workbook.dispose(); // Delete temporary files
        }

        long endTime = System.currentTimeMillis();
        long durationMs = endTime - startTime;
        long finalHeap = memoryBean.getHeapMemoryUsage().getUsed();
        long peakHeapMb = Math.max(initialHeap, finalHeap) / (1024 * 1024);

        System.out.println("=== BENCHMARK RESULT ===");
        System.out.printf("Roster Size:       %d employees%n", rosterSize);
        System.out.printf("Execution Time:    %d ms (%.2f s)%n", durationMs, durationMs / 1000.0);
        System.out.printf("Throughput:        %.1f payslips/sec%n", (rosterSize * 1000.0) / durationMs);
        System.out.printf("Peak Heap Used:    %d MB%n", peakHeapMb);
        System.out.printf("Success Count:     %d%n", successCount.get());
        System.out.printf("Error Count:       %d%n", errorCount.get());
        System.out.printf("Total Gross Sum:   %s%n", totalGross);
        System.out.printf("Total Net Sum:     %s%n", totalNet);
        System.out.println("========================");

        assertThat(errorCount.get()).isZero();
        assertThat(successCount.get()).isEqualTo(rosterSize);
        assertThat(peakHeapMb).isLessThan(384);
    }
}
