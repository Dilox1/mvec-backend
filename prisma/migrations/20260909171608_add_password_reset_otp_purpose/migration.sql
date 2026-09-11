-- AlterTable
ALTER TABLE `otps` MODIFY `phone` VARCHAR(191) NULL,
    MODIFY `purpose` ENUM('registration', 'login', 'password_reset') NOT NULL;

-- CreateIndex
CREATE INDEX `otps_email_purpose_idx` ON `otps`(`email`, `purpose`);
