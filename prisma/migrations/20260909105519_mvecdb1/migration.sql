-- AlterTable
ALTER TABLE `users` ADD COLUMN `accountStatus` ENUM('ACTIVE', 'BLOCKED') NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN `blockedAt` DATETIME(3) NULL,
    ADD COLUMN `blockedById` VARCHAR(191) NULL,
    ADD COLUMN `blockedReason` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `notifications` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` ENUM('ORDER', 'PAYMENT', 'DELIVERY', 'REFUND', 'PROMOTION', 'RECOMMENDATION', 'SUPPLIER_ORDER', 'DISPUTE', 'SUBSCRIPTION', 'AFFILIATE', 'ADVERTISEMENT', 'SUPPORT', 'SYSTEM') NOT NULL DEFAULT 'SYSTEM',
    `title` VARCHAR(191) NOT NULL,
    `body` VARCHAR(191) NOT NULL,
    `link` VARCHAR(191) NULL,
    `isRead` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_userId_isRead_idx`(`userId`, `isRead`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
