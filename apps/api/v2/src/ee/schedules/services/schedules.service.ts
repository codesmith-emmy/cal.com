import { CreateScheduleInput } from "@/ee/schedules/inputs/create-schedule.input";
import { SchedulesRepository } from "@/ee/schedules/schedules.repository";
import { AvailabilitiesService } from "@/modules/availabilities/availabilities.service";
import { UsersRepository } from "@/modules/users/users.repository";
import { Injectable } from "@nestjs/common";

@Injectable()
export class SchedulesService {
  constructor(
    private readonly schedulesRepository: SchedulesRepository,
    private readonly availabilitiesService: AvailabilitiesService,
    private readonly usersRepository: UsersRepository
  ) {}

  async createSchedule(userId: number, schedule: CreateScheduleInput) {
    const availabilities = schedule.availabilities || [this.availabilitiesService.getDefaultAvailability()];

    const createdSchedule = await this.schedulesRepository.createScheduleWithAvailabilities(
      userId,
      schedule,
      availabilities
    );

    if (schedule.isDefault) {
      await this.usersRepository.setDefaultSchedule(userId, createdSchedule.id);
    }

    return createdSchedule;
  }
}
