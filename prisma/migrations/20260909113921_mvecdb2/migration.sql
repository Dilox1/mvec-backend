-- AlterTable
ALTER TABLE `users` MODIFY `role` ENUM('buyer', 'vendor', 'supplier', 'affiliate', 'delivery', 'super_admin') NOT NULL DEFAULT 'buyer';
