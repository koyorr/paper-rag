/*
  Warnings:

  - You are about to drop the column `fileHash` on the `document` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX `Document_userId_fileHash_key` ON `document`;

-- AlterTable
ALTER TABLE `document` DROP COLUMN `fileHash`;
