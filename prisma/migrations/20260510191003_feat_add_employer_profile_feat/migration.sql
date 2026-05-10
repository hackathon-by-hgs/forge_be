-- AlterTable
ALTER TABLE "employers" ADD COLUMN     "bio" TEXT,
ADD COLUMN     "verified" BOOLEAN NOT NULL DEFAULT false;
